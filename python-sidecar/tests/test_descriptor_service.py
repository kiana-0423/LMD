from __future__ import annotations

from unittest.mock import patch

import pytest

from lmd_sidecar.services.descriptor_service import (
    calculate_descriptors,
    calculate_required_descriptors,
    calculate_required_descriptors_batch,
)

REAL_RDKIT = {
    "descriptor_set": "rdkit",
    "descriptor_version": "2026.03",
    "descriptor_count": 2,
    "mode": "real",
    "descriptors": {"MolWt": 46.069, "MolLogP": -0.0014},
}
REAL_MORDRED = {
    "descriptor_set": "mordred",
    "descriptor_version": "1.2.0",
    "descriptor_count": 1,
    "mode": "real",
    "descriptors": {"ABC": 1.4142},
}


def test_descriptor_calculation_returns_real_results():
    with patch(
        "lmd_sidecar.services.descriptor_service.calculate_rdkit_descriptors",
        return_value=(REAL_RDKIT, []),
    ):
        result, warnings = calculate_descriptors("CCO", "rdkit")

    assert result["mode"] == "real"
    assert warnings == []


def test_unsupported_descriptor_set_is_rejected():
    with pytest.raises(ValueError, match="Unsupported descriptor_set"):
        calculate_descriptors("CCO", "nonexistent")


def test_missing_rdkit_raises_instead_of_substituting_placeholder_values():
    # There is no honest fallback for a missing scientific dependency.
    with patch(
        "lmd_sidecar.services.descriptor_service.calculate_rdkit_descriptors",
        side_effect=RuntimeError("RDKit is required but is not available"),
    ):
        with pytest.raises(RuntimeError, match="RDKit is required"):
            calculate_descriptors("CCO", "rdkit")


def test_required_descriptors_combine_both_sets():
    with (
        patch(
            "lmd_sidecar.services.descriptor_service.standardize_molecule",
            return_value=({"smiles_canonical": "CCO", "mode": "real"}, []),
        ),
        patch(
            "lmd_sidecar.services.descriptor_service.calculate_rdkit_descriptors",
            return_value=(REAL_RDKIT, []),
        ),
        patch(
            "lmd_sidecar.services.descriptor_service.calculate_mordred_descriptors",
            return_value=(REAL_MORDRED, []),
        ),
    ):
        result, _ = calculate_required_descriptors("CCO")

    assert result["rdkit"]["mode"] == "real"
    assert result["mordred"]["mode"] == "real"


def test_batch_isolates_a_failing_molecule_from_the_rest():
    def fake(smiles, **_kwargs):
        if smiles == "bad":
            raise ValueError("Invalid SMILES.")
        return {"smiles_canonical": smiles, "rdkit": REAL_RDKIT, "mordred": REAL_MORDRED}, []

    with patch(
        "lmd_sidecar.services.descriptor_service.calculate_required_descriptors",
        side_effect=fake,
    ):
        result, _ = calculate_required_descriptors_batch(
            [
                {"molecule_id": "m-1", "smiles": "CCO"},
                {"molecule_id": "m-2", "smiles": "bad"},
                {"molecule_id": "m-3", "smiles": "CCC"},
            ]
        )

    assert result["success_count"] == 2
    assert result["failed_count"] == 1
    failed = [item for item in result["items"] if not item["ok"]]
    assert failed[0]["molecule_id"] == "m-2"
    assert "Invalid SMILES" in failed[0]["error"]


def test_batch_rejects_items_without_an_identifier():
    result, _ = calculate_required_descriptors_batch([{"smiles": "CCO"}])

    assert result["failed_count"] == 1
    assert "molecule_id is required" in result["items"][0]["error"]
