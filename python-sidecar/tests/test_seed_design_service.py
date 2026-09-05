import pytest
from rdkit import Chem

from lmd_sidecar.services.design_service import generate_candidates, validate_structure
from lmd_sidecar.services import seed_design_service


def request(**changes):
    return {"seeds": [{"id": "ether", "smiles": "CCCOCC"}], "max_candidates": 20, "random_seed": 42, **changes}


def test_an_omitted_or_cleared_template_generates_changed_seed_analogues():
    implicit, _ = generate_candidates(request())
    explicit, _ = generate_candidates(request(template_id=""))
    assert implicit == explicit
    assert {candidate["smiles_canonical"] for candidate in implicit["candidates"]} == {"CCOCC", "CCCOCCC"}
    assert implicit["template"] is None
    assert implicit["enumerated_total"] is None
    for candidate in implicit["candidates"]:
        assert candidate["template_id"] == ""
        assert candidate["chemical_classes"] == []
        assert candidate["seed_ids"] == ["ether"]
        assert candidate["validation"]["scope"] == "general_structure"
        assert all(finding["ok"] for finding in candidate["validation"]["findings"])


def test_no_template_requires_seeds_and_unknown_templates_still_fail():
    with pytest.raises(ValueError, match="seed molecules"):
        generate_candidates({"max_candidates": 10})
    with pytest.raises(ValueError, match="Unknown template"):
        generate_candidates(request(template_id="unrecognised"))


def test_whole_molecule_limits_are_independent_of_template_substituent_limits():
    result, _ = generate_candidates(request(
        constraints={"min_heavy_atoms": 50, "max_heavy_atoms": 60},
        candidate_constraints={"min_heavy_atoms": 5, "max_heavy_atoms": 5},
    ))
    assert [c["smiles_canonical"] for c in result["candidates"]] == ["CCOCC"]
    empty, _ = generate_candidates(request(candidate_constraints={"permitted_elements": ["C", "H"]}))
    assert not empty["candidates"]


@pytest.mark.parametrize("smiles,rule", [
    ("CC.[Na+]", "single_fragment"),
    ("C[N+](C)(C)C", "neutral"),
    ("[Zn]", "no_metals"),
    ("*CC", "complete"),
    ("not smiles", "sanitized"),
])
def test_general_validation_names_rejected_structure_rules(smiles, rule):
    result, _ = validate_structure({"smiles": smiles})
    assert not result["valid"]
    assert rule in [f["rule"] for f in result["findings"] if not f["ok"]]


def test_seeds_without_cuttable_bonds_produce_no_fake_candidates():
    result, warnings = generate_candidates(request(seeds=[{"id": "uncut", "smiles": "CCCC"}]))
    assert not result["candidates"]
    assert result["seed_reports"][0]["error"]
    assert warnings


def test_sampling_is_repeatable_bounded_and_does_not_credit_an_unused_seed(monkeypatch):
    payload = request(seeds=[{"id": "ether", "smiles": "CCCOCC"}, {"id": "unused", "smiles": "CCCC"}])
    first, _ = generate_candidates(payload)
    second, _ = generate_candidates(payload)
    assert first == second
    assert len({c["inchi_key"] for c in first["candidates"]}) == len(first["candidates"])
    assert all("unused" not in c["seed_ids"] for c in first["candidates"])
    assert all(Chem.MolFromSmiles(c["smiles_canonical"]) is not None for c in first["candidates"])
    monkeypatch.setattr(seed_design_service, "MAX_PAIRS", 2)
    limited, warnings = generate_candidates(payload)
    assert limited["parameters"]["attempted_pairs"] <= 2
    assert warnings
    capped, _ = generate_candidates(request(max_candidates=1))
    assert capped["candidate_count"] <= 1
