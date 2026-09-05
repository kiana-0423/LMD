"""Prediction evidence for unseen molecules, and the absence of anything invented."""

from __future__ import annotations

import json

import pytest

pytest.importorskip("rdkit")

from lmd_sidecar.services.assessment_service import assess_candidates
from lmd_sidecar.services.ml_service import train_model


ALKANES = [
    ("mol-1", "CCCCCC", "hexane"),
    ("mol-2", "CCCCCCCC", "octane"),
    ("mol-3", "CCCCCCCCCC", "decane"),
    ("mol-4", "CCCCCCCCCCCC", "dodecane"),
    ("mol-5", "CCCCCCCCCCCCCC", "tetradecane"),
    ("mol-6", "CCCCCCCCCCCCCCCC", "hexadecane"),
    ("mol-7", "CCCCCCCCCCCCCCCCCC", "octadecane"),
    ("mol-8", "CCCCCCCCCCCCCCCCCCCC", "eicosane"),
]


def linked_dataset(tmp_path, *, with_smiles=True, rows_per_molecule=4):
    """Eight molecules, each measured several times, with a planted linear relationship.

    The score says nothing about lubricant science: the relationship is written by this
    function. It exists so the evidence fields can be checked against known inputs.
    """
    rows = []
    for index, (molecule_id, smiles, label) in enumerate(ALKANES):
        for repeat in range(rows_per_molecule):
            weight = 86.0 + index * 28.0
            row = {
                "id": f"row-{index}-{repeat}",
                "label": label,
                "group_id": f"form-{index}-{repeat}",
                "molecule_id": molecule_id,
                "features": {"rdkit_MolWt": weight, "rdkit_MolLogP": 3.0 + index * 0.9, "concentration": 0.5 + repeat * 0.5},
                "target": 0.001 * weight + 0.01 * (0.5 + repeat * 0.5),
                "conditions": {
                    "test_type": "four-ball",
                    "base_oils": [{"id": "bo-1", "name": "PAO-6"}],
                    "temperature_value": 75.0 + repeat,
                    "temperature_unit": "°C",
                    "load_value": 392.0,
                    "load_unit": "N",
                    "additive_count": 1,
                },
            }
            if with_smiles:
                row["smiles"] = smiles
            rows.append(row)
    dataset = {
        "target": "wear_scar_diameter_value",
        "feature_order": ["rdkit_MolWt", "rdkit_MolLogP", "concentration"],
        "feature_schema_version": "4",
        "concentration_basis": "wt%",
        "dataset_mode": "additive_component",
        "dataset_scope": {"single_additive_only": True, "test_type": "four-ball"},
        "rows": rows,
    }
    path = tmp_path / "linked.json"
    path.write_text(json.dumps(dataset), encoding="utf-8")
    return path


def item(identifier, smiles, weight, logp, concentration=1.0, label=""):
    return {
        "id": identifier,
        "label": label or identifier,
        "smiles": smiles,
        "features": {"rdkit_MolWt": weight, "rdkit_MolLogP": logp, "concentration": concentration},
    }


def test_assessment_reports_coverage_neighbours_and_validation(tmp_path):
    model_path = tmp_path / "linked.joblib"
    trained, _ = train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})
    assert trained["validated"] is True

    result, warnings = assess_candidates(
        {
            "model_path": str(model_path),
            "feature_schema_version": "4",
            "items": [
                item("inside", "CCCCCCCCCCC", 156.0, 5.0, 1.0),  # undecane: between training molecules
                item("outside", "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", 422.0, 14.0, 9.0),  # far beyond every range
            ],
        }
    )

    assert warnings == []
    assert result["model_evidence"]["domain_recorded"] is True
    assert result["model_evidence"]["split_grouping"] == "linked"
    validation = result["model_evidence"]["validation"]
    assert validation["molecule_count"] >= 1
    assert validation["grouping"] == "linked"
    assert result["model_evidence"]["training_molecule_count"] == 8
    assert result["model_evidence"]["conditions"]["test_types"] == {"four-ball": 32}
    assert result["model_evidence"]["conditions"]["base_oils"][0]["id"] == "bo-1"
    assert result["model_evidence"]["dataset_scope"]["single_additive_only"] is True

    inside, outside = result["items"]
    assert isinstance(inside["value"], float)
    assert inside["evidence"]["feature_coverage"]["outside_range_count"] == 0
    assert inside["evidence"]["feature_coverage"]["fraction_in_range"] == 1.0
    nearest = inside["evidence"]["nearest_training"]
    assert nearest["training_molecule_count"] == 8
    assert 0.0 < nearest["max_similarity"] <= 1.0
    assert len(nearest["nearest"]) == 5
    assert nearest["identical_training_molecule"] is None
    # Ridge has no ensemble members, so no spread is invented for it.
    assert inside["evidence"]["model_disagreement"] is None

    coverage = outside["evidence"]["feature_coverage"]
    assert coverage["outside_range_count"] == 3
    names = {entry["feature"] for entry in coverage["outside_range"]}
    assert names == {"rdkit_MolWt", "rdkit_MolLogP", "concentration"}
    weight_entry = next(entry for entry in coverage["outside_range"] if entry["feature"] == "rdkit_MolWt")
    assert weight_entry["training_max"] == 282.0
    assert weight_entry["relative_distance"] > 0


def test_an_identical_training_molecule_is_named_rather_than_treated_as_unseen(tmp_path):
    model_path = tmp_path / "linked.joblib"
    train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})

    result, _ = assess_candidates(
        {"model_path": str(model_path), "items": [item("same", "CCCCCCCC", 114.0, 3.9, 1.0)]}
    )

    nearest = result["items"][0]["evidence"]["nearest_training"]
    assert nearest["max_similarity"] == 1.0
    assert nearest["identical_training_molecule"] == "mol-2"
    assert nearest["nearest"][0]["label"] == "octane"


def test_an_ensemble_reports_the_spread_of_its_members(tmp_path):
    model_path = tmp_path / "forest.joblib"
    train_model(
        {"dataset_path": str(linked_dataset(tmp_path, rows_per_molecule=6)), "model_path": str(model_path), "algorithm": "random_forest"}
    )

    result, _ = assess_candidates({"model_path": str(model_path), "items": [item("x", "CCCCCCCCCCC", 156.0, 5.0)]})

    spread = result["items"][0]["evidence"]["model_disagreement"]
    assert spread["method"] == "random_forest_tree_spread"
    assert spread["member_count"] == 200
    assert spread["min"] <= result["items"][0]["value"] <= spread["max"]
    assert spread["std"] >= 0.0
    assert result["model_evidence"]["disagreement_method"] == "random_forest_tree_spread"


def test_a_model_without_domain_evidence_says_so_instead_of_guessing(tmp_path):
    """A bundle written by an older build has no domain block; the evidence is reported absent."""
    import joblib

    model_path = tmp_path / "linked.joblib"
    train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})
    bundle = joblib.load(model_path)
    del bundle["domain"]
    joblib.dump(bundle, model_path)

    result, warnings = assess_candidates({"model_path": str(model_path), "items": [item("x", "CCCCCCCCCCC", 156.0, 5.0)]})

    assert result["model_evidence"]["domain_recorded"] is False
    assert result["model_evidence"]["validation"] is None
    evidence = result["items"][0]["evidence"]
    assert evidence["feature_coverage"] is None
    assert evidence["nearest_training"] is None
    assert isinstance(result["items"][0]["value"], float)
    assert any("Retrain the model" in warning for warning in warnings)


def test_assessment_refuses_a_candidate_missing_a_model_feature(tmp_path):
    model_path = tmp_path / "linked.joblib"
    train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})

    with pytest.raises(ValueError, match="missing 1 feature"):
        assess_candidates(
            {"model_path": str(model_path), "items": [{"id": "gap", "smiles": "CCCC", "features": {"rdkit_MolWt": 58.0, "rdkit_MolLogP": 2.0}}]}
        )


def test_assessment_refuses_a_stale_feature_schema(tmp_path):
    model_path = tmp_path / "linked.joblib"
    train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})

    with pytest.raises(ValueError, match="feature schema 4"):
        assess_candidates(
            {"model_path": str(model_path), "feature_schema_version": "5", "items": [item("x", "CCCC", 58.0, 2.0)]}
        )


def test_evidence_contains_no_probability_or_confidence_fields(tmp_path):
    model_path = tmp_path / "linked.joblib"
    train_model({"dataset_path": str(linked_dataset(tmp_path)), "model_path": str(model_path), "algorithm": "ridge"})
    result, _ = assess_candidates({"model_path": str(model_path), "items": [item("x", "CCCCCCCCCCC", 156.0, 5.0)]})

    encoded = json.dumps(result).lower()
    for forbidden in ("confidence", "probability", "interval", "reliab", "synthes"):
        assert forbidden not in encoded, forbidden
