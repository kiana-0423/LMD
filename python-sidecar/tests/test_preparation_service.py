"""The composite command has to produce exactly what the four commands it replaces produced.

The point of `prepare-molecule` is that one process does the work of four or five. That is only a
gain if nothing about the chemistry changes, so these tests check the results against the
individual services rather than merely checking that a result came back.

RDKit is assumed present, as it is throughout this suite: a sidecar without RDKit has no commands
worth testing.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from lmd_sidecar.services.preparation_service import prepare_molecule
from lmd_sidecar.services.rdkit_service import (
    calculate_rdkit_descriptors,
    smiles_to_molfile,
    standardize_molecule,
)
from lmd_sidecar.services.visualization_service import (
    generate_3d_from_smiles,
    visualize_from_smiles,
)

ETHANOL = "CCO"

# Real-shaped stand-ins for the two descriptor services, so a test about the *composition* of the
# command does not also spend a minute calculating 1,800 Mordred descriptors.
FAKE_RDKIT = (
    {
        "descriptor_set": "rdkit",
        "descriptor_version": "2026.06",
        "descriptor_count": 2,
        "mode": "real",
        "descriptors": {"MolWt": 46.069, "MolLogP": -0.0014},
    },
    [],
)
FAKE_MORDRED = (
    {
        "descriptor_set": "mordred",
        "descriptor_version": "1.2.0",
        "descriptor_count": 1,
        "mode": "real",
        "descriptors": {"ABC": 1.4142},
    },
    [],
)


def prepare_with_fake_descriptors(smiles: str, **kwargs):
    with patch(
        "lmd_sidecar.services.preparation_service.calculate_rdkit_descriptors",
        return_value=FAKE_RDKIT,
    ), patch(
        "lmd_sidecar.services.preparation_service.calculate_mordred_descriptors",
        return_value=FAKE_MORDRED,
    ):
        return prepare_molecule(smiles, **kwargs)


def test_identifiers_match_the_standardize_command_exactly():
    data, _ = prepare_with_fake_descriptors(ETHANOL)
    reference, _ = standardize_molecule(ETHANOL)

    for field in ("smiles_canonical", "inchi", "inchi_key", "formula", "molecular_weight"):
        assert data[field] == reference[field], field


def test_the_svg_is_a_real_drawing_of_the_molecule():
    data, _ = prepare_with_fake_descriptors(ETHANOL, include_svg=True)
    reference, _ = visualize_from_smiles(ETHANOL)

    assert "<svg" in data["svg"]
    # Both drawings come from the same RDKit renderer at the same size.
    assert data["svg"].count("<path") == reference["svg"].count("<path")


def test_the_molfile_is_a_real_connection_table():
    data, _ = prepare_with_fake_descriptors(ETHANOL, include_molfile=True)
    reference, _ = smiles_to_molfile(ETHANOL)

    # The header line carries a timestamp, so the atom/bond counts line is what is compared.
    assert data["molfile"].splitlines()[3] == reference["molfile"].splitlines()[3]


def test_three_d_generation_matches_the_dedicated_command():
    data, _ = prepare_with_fake_descriptors(ETHANOL, include_3d=True)
    reference, _ = generate_3d_from_smiles(ETHANOL)

    assert data["three_d"]["mol_block"].splitlines()[3] == reference["mol_block"].splitlines()[3]
    assert data["three_d"]["pdb_block"].startswith(reference["pdb_block"][:6])


def test_three_d_is_absent_unless_it_was_asked_for():
    data, _ = prepare_with_fake_descriptors(ETHANOL)
    assert "three_d" not in data


def test_both_required_descriptor_sets_are_present():
    data, _ = prepare_with_fake_descriptors(ETHANOL)
    assert data["rdkit"]["mode"] == "real"
    assert data["mordred"]["mode"] == "real"


def test_a_required_descriptor_failure_fails_the_whole_command():
    """The real-only policy is unchanged: no molecule is saved with invented descriptors."""
    with patch(
        "lmd_sidecar.services.preparation_service.calculate_mordred_descriptors",
        side_effect=RuntimeError("Mordred descriptors are required but Mordred is not available"),
    ), patch(
        "lmd_sidecar.services.preparation_service.calculate_rdkit_descriptors",
        return_value=FAKE_RDKIT,
    ):
        with pytest.raises(RuntimeError, match="not available"):
            prepare_molecule(ETHANOL)


def test_descriptor_sets_can_be_skipped_when_the_caller_does_not_require_them():
    data, _ = prepare_with_fake_descriptors(
        ETHANOL, require_rdkit_descriptors=False, require_mordred_descriptors=False
    )
    assert "rdkit" not in data
    assert "mordred" not in data


def test_an_invalid_smiles_is_refused_before_any_work_is_done():
    with pytest.raises(ValueError, match="Invalid SMILES"):
        prepare_molecule("not-a-smiles")


def test_an_empty_smiles_is_refused():
    with pytest.raises(ValueError, match="SMILES is required"):
        prepare_molecule("   ")


def test_the_two_dimensional_layout_does_not_leak_into_the_descriptors():
    """`Compute2DCoords` mutates the molecule it is given.

    Sharing one molecule across the whole sequence is the point of the command, so the step that
    mutates has to work on a copy — otherwise the descriptor calculation would see a conformer the
    individual commands never gave it.
    """
    captured = {}

    def capture(smiles):
        captured["smiles"] = smiles
        return FAKE_RDKIT

    with patch(
        "lmd_sidecar.services.preparation_service.calculate_rdkit_descriptors", side_effect=capture
    ), patch(
        "lmd_sidecar.services.preparation_service.calculate_mordred_descriptors",
        return_value=FAKE_MORDRED,
    ):
        prepare_molecule(ETHANOL, include_svg=True, include_molfile=True, include_3d=True)

    # The descriptor services are still handed the plain SMILES, exactly as before.
    assert captured["smiles"] == ETHANOL


def test_a_structure_that_cannot_be_embedded_still_returns_its_two_d_results():
    """A failed 3D embedding must not discard work that succeeded."""
    with patch(
        "lmd_sidecar.services.preparation_service.calculate_rdkit_descriptors",
        return_value=FAKE_RDKIT,
    ), patch(
        "lmd_sidecar.services.preparation_service.calculate_mordred_descriptors",
        return_value=FAKE_MORDRED,
    ):
        from lmd_sidecar.services import preparation_service

        real_require = preparation_service.require_rdkit

        def failing_embed():
            rdkit = real_require()
            wrapped = dict(rdkit)

            class AllChemProxy:
                def __getattr__(self, name):
                    if name == "EmbedMolecule":
                        return lambda *args, **kwargs: -1
                    return getattr(rdkit["AllChem"], name)

            wrapped["AllChem"] = AllChemProxy()
            return wrapped

        with patch.object(preparation_service, "require_rdkit", failing_embed):
            data, warnings = preparation_service.prepare_molecule(ETHANOL, include_3d=True)

    assert data["three_d"] is None
    assert any("3D" in warning for warning in warnings)
    assert data["svg"]
    assert data["rdkit"]["mode"] == "real"


def test_element_counts_are_reported_alongside_the_identifiers():
    data, _ = prepare_with_fake_descriptors(ETHANOL)
    reference, _ = calculate_rdkit_descriptors(ETHANOL)
    assert data["element_counts"]["Element_C"] == reference["descriptors"]["Element_C"]
    assert data["element_counts"]["Element_O"] == reference["descriptors"]["Element_O"]
