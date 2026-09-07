import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest
from rdkit import Chem
from rdkit.Chem import Crippen

from lmd_sidecar.services.model_example_service import example_dataset, explain_model_example


def test_case_targets_are_computed_and_never_used_as_input_features():
    dataset = example_dataset()
    assert len(dataset["rows"]) == 48
    assert len({row["molecule_id"] for row in dataset["rows"]}) == 48
    assert len(dataset["feature_order"]) == 8
    assert all("logp" not in name.lower() and "crippen" not in name.lower() for name in dataset["feature_order"])
    for row in dataset["rows"]:
        assert row["target"] == pytest.approx(Crippen.MolLogP(Chem.MolFromSmiles(row["smiles"])))
        assert np.isfinite(list(row["features"].values())).all()


def test_case_runs_in_empty_directory_and_cleans_up_model_artifacts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    first, warnings = explain_model_example({})
    second, _ = explain_model_example({})
    assert first == second
    assert not warnings
    assert list(tmp_path.iterdir()) == []
    assert first["case_study"]["algorithm"] == "ridge"
    assert first["case_study"]["sample_count"] == 48
    assert first["case_study"]["metrics"]["validation"]["grouping"] == "linked"
    explanation = first["explanation"]
    assert explanation["cohort"] == "training_reference"
    assert len(explanation["importance"]) == 8
    for sample in explanation["samples"]:
        assert sample["base_value"] + sum(sample["shap_values"]) == pytest.approx(sample["prediction"])
        assert sample["reference_value"] == pytest.approx(Crippen.MolLogP(Chem.MolFromSmiles(sample["id"])))


def test_case_real_cli_without_workspace_or_pretrained_model(tmp_path):
    request = tmp_path / "input.json"
    request.write_text("{}")
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    result = subprocess.run([sys.executable, "-m", "lmd_sidecar.main", "explain-model-example", "--input", str(request)],
                            cwd=tmp_path, env=env, capture_output=True, text=True, check=True, timeout=60)
    data = json.loads(result.stdout)
    assert data["ok"] is True
    assert data["data"]["mode"] == "real"
    assert len(data["data"]["explanation"]["samples"]) == 48
    assert sorted(p.name for p in tmp_path.iterdir()) == ["input.json"]
