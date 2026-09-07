import json
import subprocess
import sys
from pathlib import Path

import joblib
import numpy as np
import pytest

from lmd_sidecar.services.explanation_service import explain_model
from lmd_sidecar.services.ml_service import predict_with_model, train_model
from lmd_sidecar.utils.errors import ExplanationReferenceError, classify_error
from test_ml_service import build_dataset


@pytest.mark.parametrize("algorithm", ["ridge", "random_forest", "hist_gradient_boosting"])
def test_shap_reconstructs_real_pipeline_predictions_and_ranks_contributions(tmp_path, algorithm):
    path = tmp_path / "model.joblib"
    dataset = build_dataset(tmp_path, 40, schema_version="4")
    train_model({"dataset_path": str(dataset), "model_path": str(path), "algorithm": algorithm})
    items = [{"id": "candidate", "label": "Candidate", "features": {
        "rdkit_MolWt": 211, "rdkit_MolLogP": None, "concentration": 1.3
    }}]
    payload = {"model_path": str(path), "feature_schema_version": "4", "items": items}
    expected, _ = predict_with_model(payload)
    data, _ = explain_model(payload)
    row = data["samples"][0]
    assert row["prediction"] == pytest.approx(expected["predictions"][0]["value"])
    assert row["base_value"] + sum(row["shap_values"]) == pytest.approx(row["prediction"], rel=1e-5)
    assert row["feature_values"] == [211, None, 1.3]
    assert data["cohort"] == "selected_molecules"
    assert data["sample_count"] == data["total_count"] == 1
    assert data["mode"] == "real"
    by_name = dict(zip(data["feature_names"], map(abs, row["shap_values"])))
    assert [item["mean_abs_shap"] for item in data["importance"]] == sorted(by_name.values(), reverse=True)
    for item in data["importance"]:
        assert item["mean_abs_shap"] == pytest.approx(by_name[item["feature"]])
    if algorithm == "ridge":
        bundle = joblib.load(path)
        transform = bundle["pipeline"][:-1]
        reference = transform.transform(bundle["explanation_reference"]["matrix"])
        candidate = transform.transform(np.array([[211, np.nan, 1.3]]))
        assert np.allclose(row["shap_values"], (candidate[0] - reference.mean(axis=0)) * bundle["pipeline"].named_steps["model"].coef_)


def test_reference_is_saved_deterministic_bounded_and_independent_of_later_dataset_edits(tmp_path):
    path = tmp_path / "model.joblib"
    dataset = build_dataset(tmp_path, 240, schema_version="4")
    train_model({"dataset_path": str(dataset), "model_path": str(path), "algorithm": "ridge"})
    dataset.write_text("{}")
    request = {"model_path": str(path), "feature_schema_version": "4"}
    first, _ = explain_model(request)
    second, _ = explain_model(request)
    assert first == second
    assert first["cohort"] == "training_reference"
    assert first["total_count"] == 240
    assert first["reference_count"] == 200
    assert first["background_count"] == 64
    assert first["sample_count"] == 50
    expected = np.abs(np.array([row["shap_values"] for row in first["samples"]])).mean(axis=0)
    assert {row["feature"]: row["mean_abs_shap"] for row in first["importance"]} == pytest.approx(dict(zip(first["feature_names"], expected)))


def test_legacy_model_can_still_predict_but_explanation_requires_retraining(tmp_path):
    path = tmp_path / "model.joblib"
    dataset = build_dataset(tmp_path, 20)
    train_model({"dataset_path": str(dataset), "model_path": str(path)})
    bundle = joblib.load(path)
    del bundle["explanation_reference"]
    joblib.dump(bundle, path)
    payload = {"model_path": str(path), "items": json.loads(dataset.read_text())["rows"][:1]}
    assert predict_with_model(payload)[0]["predictions"]
    with pytest.raises(ExplanationReferenceError) as failure:
        explain_model(payload)
    assert classify_error("explain-model", failure.value).code == "model.explanationReferenceMissing"


def test_explanation_refuses_wrong_schema_and_missing_feature_names(tmp_path):
    path = tmp_path / "model.joblib"
    train_model({"dataset_path": str(build_dataset(tmp_path, 20, schema_version="4")), "model_path": str(path)})
    with pytest.raises(ValueError, match="schema"):
        explain_model({"model_path": str(path), "feature_schema_version": "3"})
    with pytest.raises(ValueError, match="missing"):
        explain_model({"model_path": str(path), "items": [{"id": "incomplete", "features": {}}]})


def test_real_cli_emits_json_shap_results(tmp_path):
    path = tmp_path / "model.joblib"
    train_model({"dataset_path": str(build_dataset(tmp_path, 20)), "model_path": str(path), "algorithm": "ridge"})
    payload = tmp_path / "request.json"
    payload.write_text(json.dumps({"model_path": str(path)}))
    process = subprocess.run([sys.executable, "-m", "lmd_sidecar.main", "explain-model", "--input", str(payload)],
                             cwd=Path(__file__).resolve().parents[1], text=True, capture_output=True, check=True)
    result = json.loads(process.stdout)
    assert result["ok"]
    assert result["data"]["method"].startswith("LinearExplainer")
    assert len(result["data"]["samples"]) == 20
