"""Template-constrained generation: specificity, core preservation, deduplication, provenance.

Every test here runs real RDKit. The generator's whole value is that it cannot produce a structure
outside the requested class, and only the real toolkit can show that.
"""

from __future__ import annotations

import pytest

pytest.importorskip("rdkit")

from rdkit import Chem

from lmd_sidecar.services.design_service import (
    MAX_CANDIDATES,
    generate_candidates,
    list_templates,
    validate_structure,
)
from lmd_sidecar.services.design_templates import (
    CURATED_SUBSTITUENTS,
    GENERATOR_VERSION,
    TEMPLATES,
    SubstituentConstraints,
    describe_substituent,
    extract_substituents,
    parse_substituent_smiles,
    validate_phosphate_candidate,
)


def failing_rules(findings):
    return [finding["rule"] for finding in findings if not finding["ok"]]


# --- template specificity ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("smiles", "expected_rule"),
    [
        ("CCOP(OCC)OCC", "phosphate_core"),  # triethyl phosphite: P(III)
        ("CCP(=O)(OCC)OCC", "phosphate_core"),  # a phosphonate: P-C bond
        ("CCOP(=S)(OCC)OCC", "phosphate_core"),  # a thiophosphate: P=S
        ("CCOP(=O)(OCC)SCC", "phosphate_core"),  # a thiophosphate: P-S
        ("CCOP(=O)(OCC)NCC", "phosphate_core"),  # a phosphoramidate: P-N
        ("CCOP(=O)(OCC)OP(=O)(OCC)OCC", "single_phosphorus"),  # a pyrophosphate
        ("CCOP(=O)(OCC)[O-].[Na+]", "single_fragment"),  # a sodium salt with a counterion
        ("CCOP(=O)(OCC)[O-].[Zn+2].[O-]P(=O)(OCC)OCC", "no_metals"),  # a zinc salt
        ("CCOP(=O)(OCC)O[Si](C)(C)C", "ester_oxygen_substituents"),  # an O-Si ester
        ("CCOP(=O)(O)O", "esterification_degree"),  # a monoester asked for as a triester
        ("CCCC", "single_phosphorus"),  # no phosphorus at all
    ],
)
def test_structures_outside_the_triester_template_are_rejected_by_the_rule_that_names_them(
    smiles, expected_rule
):
    result, _ = validate_structure({"template_id": "phosphate_triester", "smiles": smiles})

    assert result["valid"] is False
    assert expected_rule in failing_rules(result["findings"]), result["findings"]


def test_the_presence_of_phosphorus_alone_is_not_enough():
    """The failure mode this guards against: a phosphite passing as a phosphate because it has P."""
    result, _ = validate_structure({"template_id": "phosphate_triester", "smiles": "CCOP(OCC)OCC"})
    assert result["valid"] is False
    findings = {item["rule"]: item for item in result["findings"]}
    assert findings["single_phosphorus"]["ok"] is True
    assert findings["phosphate_core"]["ok"] is False
    assert "P(III)" in findings["phosphate_core"]["detail"] or "phosphite" in findings["phosphate_core"]["detail"]


@pytest.mark.parametrize(
    ("template_id", "smiles"),
    [
        ("phosphate_monoester", "CCCCOP(=O)(O)O"),
        ("phosphate_diester", "CCCCOP(=O)(O)OCCCC"),
        ("phosphate_triester", "CCCCOP(=O)(OCCCC)OCCCC"),
        ("phosphate_triester", "Cc1ccccc1OP(=O)(Oc1ccccc1C)Oc1ccccc1C"),
    ],
)
def test_structures_inside_a_template_pass_every_rule(template_id, smiles):
    result, _ = validate_structure({"template_id": template_id, "smiles": smiles})
    assert result["valid"] is True, result["findings"]
    assert result["inchi_key"]
    assert result["smiles_canonical"] == Chem.MolToSmiles(Chem.MolFromSmiles(smiles))


def test_the_esterification_degree_is_template_specific():
    diester = "CCCCOP(=O)(O)OCCCC"
    ok, _ = validate_structure({"template_id": "phosphate_diester", "smiles": diester})
    wrong, _ = validate_structure({"template_id": "phosphate_triester", "smiles": diester})
    assert ok["valid"] is True
    assert wrong["valid"] is False
    assert "esterification_degree" in failing_rules(wrong["findings"])


# --- core preservation ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", list(TEMPLATES))
def test_every_generated_candidate_keeps_the_selected_core_and_degree(template_id):
    template = TEMPLATES[template_id]
    result, _ = generate_candidates(
        {"template_id": template_id, "max_candidates": 40, "random_seed": 3, "constraints": {"max_heavy_atoms": 10}}
    )

    assert result["candidate_count"] > 0
    assert result["generator_version"] == GENERATOR_VERSION
    for candidate in result["candidates"]:
        mol = Chem.MolFromSmiles(candidate["smiles_canonical"])
        assert mol is not None
        # Re-validated from the SMILES alone, so the check does not trust the generator's own word.
        findings = validate_phosphate_candidate(mol, template, SubstituentConstraints())
        assert all(finding.ok for finding in findings), [f.to_json() for f in findings]
        assert candidate["esterification_degree"] == template.degree
        assert len(candidate["substituents"]) == template.degree
        assert len(extract_substituents(mol)) == template.degree
        assert candidate["template_id"] == template_id
        assert set(template.chemical_classes) <= set(candidate["chemical_classes"])
        assert candidate["validation"]["status"] == "valid"
        assert candidate["svg"].lstrip().startswith("<?xml") or "<svg" in candidate["svg"]


def test_generation_never_emits_anything_but_a_phosphate_ester():
    """Every element and bond around the phosphorus is what the template says, in every candidate."""
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_triester",
            "max_candidates": 60,
            "random_seed": 11,
            "constraints": {"permitted_elements": ["C", "H", "O", "N", "S"], "max_heavy_atoms": 12},
        }
    )
    for candidate in result["candidates"]:
        mol = Chem.MolFromSmiles(candidate["smiles_canonical"])
        phosphorus = [atom for atom in mol.GetAtoms() if atom.GetAtomicNum() == 15]
        assert len(phosphorus) == 1
        neighbours = sorted(nbr.GetSymbol() for nbr in phosphorus[0].GetNeighbors())
        assert neighbours == ["O", "O", "O", "O"]
        assert all(atom.GetFormalCharge() == 0 for atom in mol.GetAtoms())
        assert len(Chem.GetMolFrags(mol)) == 1


# --- substituent controls -----------------------------------------------------------------------


def test_substituent_size_branching_element_and_type_limits_are_enforced():
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_monoester",
            "max_candidates": MAX_CANDIDATES,
            "constraints": {
                "permitted_elements": ["C", "H"],
                "allowed_types": ["linear_alkyl"],
                "min_heavy_atoms": 4,
                "max_heavy_atoms": 8,
                "max_branch_points": 0,
            },
        }
    )
    accepted = {item["source_id"] for item in result["substituents"]}
    assert accepted == {"n_butyl", "n_hexyl", "n_octyl"}
    rejected = {item["source_id"]: item["rules"] for item in result["rejected_substituents"]}
    assert "max_heavy_atoms" in rejected["n_decyl"]
    assert "allowed_types" in rejected["two_ethylhexyl"] and "max_branch_points" in rejected["two_ethylhexyl"]
    assert "permitted_elements" in rejected["two_methoxyethyl"]
    assert "min_heavy_atoms" in rejected["ethyl"]
    assert "allowed_types" in rejected["phenyl"]


def test_substituent_classification_names_the_shape_of_each_group():
    kinds = {}
    for item in CURATED_SUBSTITUENTS:
        described = describe_substituent(parse_substituent_smiles(item.smiles), source="curated")
        kinds[item.id] = (described.type, described.branch_points)
    assert kinds["n_butyl"] == ("linear_alkyl", 0)
    assert kinds["isopropyl"] == ("branched_alkyl", 1)
    assert kinds["tert_butyl"] == ("branched_alkyl", 1)
    assert kinds["two_ethylhexyl"] == ("branched_alkyl", 1)
    assert kinds["oleyl"][0] == "alkenyl"
    assert kinds["cyclohexyl"][0] == "cycloalkyl"
    assert kinds["phenyl"][0] == "aryl"
    assert kinds["p_tolyl"][0] == "alkylaryl"
    assert kinds["benzyl"][0] == "aralkyl"
    assert kinds["two_methoxyethyl"][0] == "heteroatom_alkyl"


def test_a_substituent_attached_through_a_heteroatom_is_refused():
    with pytest.raises(ValueError, match="through a carbon"):
        describe_substituent(parse_substituent_smiles("[*]OCC"), source="curated")
    with pytest.raises(ValueError, match="exactly one attachment"):
        describe_substituent(parse_substituent_smiles("[*]CC[*]"), source="curated")


def test_unknown_controls_are_refused_rather_than_ignored():
    with pytest.raises(ValueError, match="Permitted elements"):
        generate_candidates({"template_id": "phosphate_monoester", "constraints": {"permitted_elements": ["Zn"]}})
    with pytest.raises(ValueError, match="Substituent types"):
        generate_candidates({"template_id": "phosphate_monoester", "constraints": {"allowed_types": ["polymer"]}})
    with pytest.raises(ValueError, match="Unknown template"):
        generate_candidates({"template_id": "zinc_dithiophosphate"})
    with pytest.raises(ValueError, match="max_candidates"):
        generate_candidates({"template_id": "phosphate_monoester", "max_candidates": MAX_CANDIDATES + 1})


# --- deduplication and bounding ----------------------------------------------------------------


def test_candidates_are_deduplicated_by_structure():
    result, _ = generate_candidates(
        {"template_id": "phosphate_diester", "max_candidates": MAX_CANDIDATES, "curated_substituent_ids": ["ethyl", "n_butyl", "phenyl"]}
    )
    keys = [candidate["inchi_key"] for candidate in result["candidates"]]
    assert len(keys) == len(set(keys))
    # Three substituents over two equivalent positions: C(3+1, 2) = 6 distinct esters.
    assert result["candidate_count"] == 6
    assert result["enumerated_total"] == 6


def test_identical_substituents_only_produces_symmetric_esters():
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_triester",
            "identical_substituents": True,
            "max_candidates": MAX_CANDIDATES,
            "curated_substituent_ids": ["ethyl", "n_butyl", "phenyl"],
        }
    )
    assert result["candidate_count"] == 3
    for candidate in result["candidates"]:
        smiles = {item["smiles"] for item in candidate["substituents"]}
        assert len(smiles) == 1


def test_sampling_is_deterministic_for_a_recorded_seed():
    request = {"template_id": "phosphate_triester", "max_candidates": 15, "random_seed": 99}
    first, warnings = generate_candidates(request)
    second, _ = generate_candidates(request)
    third, _ = generate_candidates({**request, "random_seed": 100})

    assert first["candidate_count"] == 15
    assert [c["inchi_key"] for c in first["candidates"]] == [c["inchi_key"] for c in second["candidates"]]
    assert [c["inchi_key"] for c in first["candidates"]] != [c["inchi_key"] for c in third["candidates"]]
    assert first["random_seed"] == 99
    assert any("sampled deterministically" in warning for warning in warnings)


def test_the_request_is_echoed_as_provenance():
    result, _ = generate_candidates(
        {"template_id": "phosphate_monoester", "max_candidates": 5, "random_seed": 1, "constraints": {"max_heavy_atoms": 6}}
    )
    parameters = result["parameters"]
    assert parameters["template_id"] == "phosphate_monoester"
    assert parameters["constraints"]["max_heavy_atoms"] == 6
    assert parameters["random_seed"] == 1
    for candidate in result["candidates"]:
        assert candidate["generator_version"] == GENERATOR_VERSION
        for substituent in candidate["substituents"]:
            assert substituent["source"] == "curated"
            assert substituent["source_id"]


# --- seeds -----------------------------------------------------------------------------------------


def test_a_phosphate_seed_donates_its_own_substituents():
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_triester",
            "substituent_sources": ["seed_substituents"],
            "identical_substituents": True,
            "seeds": [{"id": "lib-1", "smiles": "CCCCC(CC)COP(=O)(OCC(CC)CCCC)OCC(CC)CCCC"}],
            "max_candidates": 10,
        }
    )
    report = result["seed_reports"][0]
    assert report["is_phosphate_ester"] is True
    assert report["substituents_extracted"] == 3
    # Three identical 2-ethylhexyl groups collapse to one substituent.
    assert result["substituent_count"] == 1
    assert result["substituents"][0]["source"] == "seed"
    assert result["candidates"][0]["seed_ids"] == ["lib-1"]
    assert Chem.MolToSmiles(Chem.MolFromSmiles(result["candidates"][0]["smiles_canonical"])) == Chem.MolToSmiles(
        Chem.MolFromSmiles("CCCCC(CC)COP(=O)(OCC(CC)CCCC)OCC(CC)CCCC")
    )


def test_a_seed_outside_the_template_contributes_fragments_but_never_its_core():
    """A zinc dithiophosphate seed is cut for its alkyl groups; nothing about ZDDP survives."""
    zddp_like = "CCCCOP(=S)(OCCCC)S"
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_monoester",
            "substituent_sources": ["brics"],
            "seeds": [{"id": "seed-zddp", "smiles": zddp_like}],
            "max_candidates": 20,
        }
    )
    report = result["seed_reports"][0]
    assert report["is_phosphate_ester"] is False
    for candidate in result["candidates"]:
        mol = Chem.MolFromSmiles(candidate["smiles_canonical"])
        assert not any(atom.GetAtomicNum() == 16 for atom in mol.GetAtoms()), "sulfur must not survive"
        assert candidate["template_id"] == "phosphate_monoester"
        assert candidate["seed_ids"] == ["seed-zddp"]


def test_an_unreadable_seed_is_reported_not_fatal():
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_monoester",
            "substituent_sources": ["curated", "seed_substituents"],
            "seeds": [{"id": "bad", "smiles": "not a smiles"}],
            "max_candidates": 5,
        }
    )
    assert result["seed_reports"][0]["error"] == "Unreadable SMILES."
    assert result["candidate_count"] > 0


def test_brics_fragments_obey_the_same_constraints_as_curated_ones():
    result, _ = generate_candidates(
        {
            "template_id": "phosphate_monoester",
            "substituent_sources": ["brics"],
            "seeds": [{"id": "s", "smiles": "CCCCCCCCCCCCOC(=O)c1ccccc1"}],
            "constraints": {"permitted_elements": ["C", "H"], "max_heavy_atoms": 6},
            "max_candidates": 20,
        }
    )
    for substituent in result["substituents"]:
        assert substituent["heavy_atoms"] <= 6
        assert set(substituent["elements"]) <= {"C", "H"}


# --- empty and catalogue ---------------------------------------------------------------------------


def test_no_permitted_substituent_yields_no_candidates_and_says_so():
    result, warnings = generate_candidates(
        {"template_id": "phosphate_monoester", "constraints": {"min_heavy_atoms": 50, "max_heavy_atoms": 60}}
    )
    assert result["candidate_count"] == 0
    assert result["substituent_count"] == 0
    assert any("No substituent satisfied" in warning for warning in warnings)


def test_the_catalogue_lists_the_three_phosphate_templates():
    catalogue, _ = list_templates({})
    ids = [template["id"] for template in catalogue["templates"]]
    assert ids == ["phosphate_monoester", "phosphate_diester", "phosphate_triester"]
    assert [template["degree"] for template in catalogue["templates"]] == [1, 2, 3]
    assert catalogue["generator_version"] == GENERATOR_VERSION
    assert catalogue["limits"]["max_candidates"] == MAX_CANDIDATES
    assert len(catalogue["curated_substituents"]) == len(CURATED_SUBSTITUENTS)


def test_the_response_carries_no_performance_claim():
    """A generated structure has a structure, a provenance and a validation — nothing else."""
    result, _ = generate_candidates({"template_id": "phosphate_monoester", "max_candidates": 3})
    for candidate in result["candidates"]:
        for forbidden in ("prediction", "score", "performance", "antiwear", "synthesis", "novel"):
            assert forbidden not in " ".join(candidate.keys()).lower()
