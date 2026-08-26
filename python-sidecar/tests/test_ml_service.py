from __future__ import annotations

import json

import pytest

from lmd_sidecar.services.ml_service import (
    InsufficientDataError,
    describe_model,
    predict_with_model,
    train_model,
)


def build_dataset(
    tmp_path,
    count: int,
    feature_order=("rdkit_MolWt", "rdkit_MolLogP", "concentration"),
    group_size: int = 0,
    schema_version: str = "2",
    concentration_basis: str = "wt%",
):
    """A synthetic dataset with a known linear relationship.

    This exercises the training pipeline only. The scores it produces say nothing about how well
    a model predicts real lubricant performance — the relationship is planted by this function.
    `group_size` repeats each group id that many times, standing in for repeated measurements of
    one formulation.
    """
    rows = []
    for index in range(count):
        weight = 100.0 + index * 3.0
        logp = 1.0 + index * 0.1
        concentration = 0.5 + (index % 5) * 0.25
        row = {
                "id": f"row-{index}",
                "features": {
                    "rdkit_MolWt": weight,
                    "rdkit_MolLogP": logp,
                    "concentration": concentration,
                },
                "target": 0.02 * weight + 0.5 * concentration,
        }
        if group_size:
            row["group_id"] = f"formulation-{index // group_size}"
        rows.append(row)
    dataset = {
        "target": "average_friction_coefficient",
        "feature_order": list(feature_order),
        "feature_schema_version": schema_version,
        "concentration_basis": concentration_basis,
        "rows": rows,
    }
    path = tmp_path / "dataset.json"
    path.write_text(json.dumps(dataset), encoding="utf-8")
    return path


def test_training_produces_a_loadable_model_on_a_synthetic_fixture(tmp_path):
    """Pipeline test only. The high score below reflects the planted linear relationship in the
    fixture, not any claim about real lubricant prediction accuracy."""
    dataset = build_dataset(tmp_path, 40)
    model_path = tmp_path / "models" / "friction.joblib"

    result, warnings = train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    assert result["mode"] == "real"
    assert model_path.is_file()
    assert result["sample_count"] == 40
    assert result["feature_count"] == 3
    assert result["feature_order"] == ["rdkit_MolWt", "rdkit_MolLogP", "concentration"]
    # 40 rows is above the validation threshold, so a held-out score is reported.
    assert "validation" in result["metrics"]
    assert result["metrics"]["validation"]["r2"] > 0.9
    # Without group ids the split cannot guarantee independence, and says so.
    assert any(warning["code"] == "training.ungroupedSplit" for warning in warnings)
    # The English diagnostic travels beside the code rather than instead of it.
    assert any("no group ids" in warning["detail"] for warning in warnings)
    assert result["split_method"].startswith("train_test_split")


def test_small_dataset_reports_in_sample_metrics_and_warns(tmp_path):
    dataset = build_dataset(tmp_path, 14)
    model_path = tmp_path / "small.joblib"

    result, warnings = train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    assert "training_only" in result["metrics"]
    assert any(warning["code"] == "training.smallSample" for warning in warnings)
    assert any("in-sample" in warning["detail"] for warning in warnings)


def test_training_refuses_an_undersized_dataset(tmp_path):
    dataset = build_dataset(tmp_path, 4)

    with pytest.raises(InsufficientDataError) as error:
        train_model({"dataset_path": str(dataset), "model_path": str(tmp_path / "m.joblib")})

    # The error has to say how many records are needed and how many exist.
    assert "at least 12" in str(error.value)
    assert "provides 4" in str(error.value)


def test_training_refuses_a_dataset_without_features(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"target": "x", "feature_order": [], "rows": []}), encoding="utf-8")

    with pytest.raises(InsufficientDataError, match="no numeric feature columns"):
        train_model({"dataset_path": str(path), "model_path": str(tmp_path / "m.joblib")})


def test_training_rejects_a_missing_dataset(tmp_path):
    with pytest.raises(FileNotFoundError, match="Training dataset not found"):
        train_model({"dataset_path": str(tmp_path / "absent.json"), "model_path": str(tmp_path / "m.joblib")})


def test_prediction_round_trips_through_the_saved_model(tmp_path):
    dataset = build_dataset(tmp_path, 40)
    model_path = tmp_path / "friction.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    result, _ = predict_with_model(
        {
            "model_path": str(model_path),
            "items": [
                {
                    "id": "candidate-1",
                    "label": "ZDDP-like",
                    "features": {"rdkit_MolWt": 160.0, "rdkit_MolLogP": 2.0, "concentration": 1.0},
                }
            ],
        }
    )

    assert result["mode"] == "real"
    assert len(result["predictions"]) == 1
    predicted = result["predictions"][0]["value"]
    # Expected value from the generating relationship is 0.02*160 + 0.5*1.0 = 3.7.
    assert 3.0 < predicted < 4.4


def test_prediction_rejects_an_item_missing_a_required_feature(tmp_path):
    dataset = build_dataset(tmp_path, 40)
    model_path = tmp_path / "friction.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    with pytest.raises(ValueError) as error:
        predict_with_model(
            {
                "model_path": str(model_path),
                "items": [{"id": "bad", "features": {"rdkit_MolWt": 160.0}}],
            }
        )

    assert "missing 2 feature(s)" in str(error.value)
    assert "rdkit_MolLogP" in str(error.value)


def test_prediction_rejects_a_missing_model(tmp_path):
    with pytest.raises(FileNotFoundError, match="Train a model for this target first"):
        predict_with_model({"model_path": str(tmp_path / "none.joblib"), "items": [{"features": {}}]})


def test_prediction_rejects_a_file_that_is_not_a_model_bundle(tmp_path):
    import joblib

    path = tmp_path / "corrupt.joblib"
    joblib.dump({"not": "a model"}, path)

    with pytest.raises(ValueError, match="not an LMD model bundle"):
        predict_with_model({"model_path": str(path), "items": [{"features": {}}]})


def test_describe_model_reports_the_stored_feature_order(tmp_path):
    dataset = build_dataset(tmp_path, 40)
    model_path = tmp_path / "friction.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    result, _ = describe_model({"model_path": str(model_path)})

    assert result["feature_order"] == ["rdkit_MolWt", "rdkit_MolLogP", "concentration"]
    assert result["target"] == "average_friction_coefficient"
    assert result["algorithm"] in {"ridge", "random_forest", "hist_gradient_boosting"}


def test_a_feature_that_is_always_missing_is_dropped_with_a_warning(tmp_path):
    dataset = build_dataset(tmp_path, 30)
    payload = json.loads(dataset.read_text(encoding="utf-8"))
    payload["feature_order"].append("mordred_NeverPresent")
    dataset.write_text(json.dumps(payload), encoding="utf-8")

    result, warnings = train_model(
        {"dataset_path": str(dataset), "model_path": str(tmp_path / "m.joblib")}
    )

    assert "mordred_NeverPresent" in result["dropped_features"]
    assert result["feature_count"] == 3
    assert any(warning["code"] == "training.droppedFeatures" for warning in warnings)
    assert any("dropped" in warning["detail"] for warning in warnings)


def test_grouped_split_keeps_one_formulation_out_of_both_sides(tmp_path, monkeypatch):
    """Repeated measurements of a formulation must not straddle the split."""
    dataset = build_dataset(tmp_path, 40, group_size=4)

    captured = {}
    from sklearn.model_selection import GroupShuffleSplit as RealSplitter

    class RecordingSplitter(RealSplitter):
        def split(self, X, y=None, groups=None):
            for train_index, valid_index in super().split(X, y, groups):
                captured["train"] = {groups[i] for i in train_index}
                captured["valid"] = {groups[i] for i in valid_index}
                yield train_index, valid_index

    monkeypatch.setattr("sklearn.model_selection.GroupShuffleSplit", RecordingSplitter)

    result, warnings = train_model(
        {"dataset_path": str(dataset), "model_path": str(tmp_path / "grouped.joblib")}
    )

    assert result["split_method"].startswith("GroupShuffleSplit")
    assert result["group_count"] == 10
    # The decisive assertion: no formulation appears on both sides.
    assert captured["train"] and captured["valid"]
    assert captured["train"].isdisjoint(captured["valid"])
    assert not any(warning["code"] == "training.ungroupedSplit" for warning in warnings)


def test_the_grouped_split_is_deterministic(tmp_path):
    dataset = build_dataset(tmp_path, 40, group_size=4)

    first, _ = train_model({"dataset_path": str(dataset), "model_path": str(tmp_path / "a.joblib")})
    second, _ = train_model({"dataset_path": str(dataset), "model_path": str(tmp_path / "b.joblib")})

    assert first["metrics"]["validation"]["r2"] == second["metrics"]["validation"]["r2"]


def test_the_saved_bundle_records_how_the_split_was_made(tmp_path):
    dataset = build_dataset(tmp_path, 40, group_size=4)
    model_path = tmp_path / "grouped.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    described, _ = describe_model({"model_path": str(model_path)})

    assert described["split_method"].startswith("GroupShuffleSplit")


def test_a_constant_target_does_not_produce_nan_metrics(tmp_path):
    """A validation split with no variance cannot be scored; NaN would break the JSON contract."""
    rows = [
        {
            "id": f"row-{index}",
            "group_id": f"formulation-{index // 4}",
            "features": {"rdkit_MolWt": 100.0 + index, "rdkit_MolLogP": 1.0, "concentration": 1.0},
            # Every measurement identical.
            "target": 0.08,
        }
        for index in range(24)
    ]
    path = tmp_path / "constant.json"
    path.write_text(
        json.dumps(
            {
                "target": "average_friction_coefficient",
                "feature_order": ["rdkit_MolWt", "rdkit_MolLogP", "concentration"],
                "rows": rows,
            }
        ),
        encoding="utf-8",
    )

    result, warnings = train_model(
        {"dataset_path": str(path), "model_path": str(tmp_path / "constant.joblib")}
    )

    # Whatever is reported must survive a JSON round trip, which NaN does not.
    encoded = json.dumps(result, allow_nan=False)
    assert "NaN" not in encoded
    for block in result["metrics"].values():
        for key in ("r2", "mae", "rmse"):
            assert block[key] == block[key]  # not NaN
    assert (
        any("not enough to score" in warning["detail"] for warning in warnings)
        or result["metrics"]
    )


def test_the_bundle_records_the_dataset_interpretation(tmp_path):
    dataset = build_dataset(tmp_path, 40, group_size=4)
    payload = json.loads(dataset.read_text(encoding="utf-8"))
    payload["dataset_mode"] = "formulation_aggregate"
    payload["interpretation"] = "One row per measured result."
    dataset.write_text(json.dumps(payload), encoding="utf-8")
    model_path = tmp_path / "aggregate.joblib"

    result, _ = train_model({"dataset_path": str(dataset), "model_path": str(model_path)})
    described, _ = describe_model({"model_path": str(model_path)})

    assert result["dataset_mode"] == "formulation_aggregate"
    # The interpretation survives into the saved bundle, so a later reader knows what a row meant.
    assert described["dataset_mode"] == "formulation_aggregate"
    assert described["interpretation"] == "One row per measured result."
    assert described["split_method"].startswith("GroupShuffleSplit")


def test_the_bundle_records_the_feature_schema_and_concentration_basis(tmp_path):
    """A fitted pipeline is only meaningful alongside the definition of its columns."""
    dataset = build_dataset(tmp_path, 30)
    model_path = tmp_path / "schema.joblib"

    result, _ = train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    assert result["feature_schema_version"] == "2"
    assert result["concentration_basis"] == "wt%"
    described, _ = describe_model({"model_path": str(model_path)})
    assert described["feature_schema_version"] == "2"
    assert described["concentration_basis"] == "wt%"


def test_prediction_refuses_a_model_fitted_under_another_feature_schema(tmp_path):
    """The columns of an older model no longer mean what the caller thinks they mean, so the
    request is refused rather than answered with a number computed from mismatched inputs."""
    dataset = build_dataset(tmp_path, 30, schema_version="1")
    model_path = tmp_path / "old.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    with pytest.raises(ValueError) as caught:
        predict_with_model(
            {
                "model_path": str(model_path),
                "feature_schema_version": "2",
                "items": [
                    {
                        "id": "m-1",
                        "features": {
                            "rdkit_MolWt": 180.0,
                            "rdkit_MolLogP": 2.0,
                            "concentration": 1.0,
                        },
                    }
                ],
            }
        )

    assert "feature schema 1" in str(caught.value)
    assert "retrain" in str(caught.value).lower()


def test_prediction_accepts_a_model_fitted_under_the_same_feature_schema(tmp_path):
    dataset = build_dataset(tmp_path, 30, schema_version="2")
    model_path = tmp_path / "current.joblib"
    train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    result, _ = predict_with_model(
        {
            "model_path": str(model_path),
            "feature_schema_version": "2",
            "items": [
                {
                    "id": "m-1",
                    "label": "Test molecule",
                    "features": {
                        "rdkit_MolWt": 180.0,
                        "rdkit_MolLogP": 2.0,
                        "concentration": 1.0,
                    },
                }
            ],
        }
    )

    assert result["feature_schema_version"] == "2"
    assert len(result["predictions"]) == 1
    assert isinstance(result["predictions"][0]["value"], float)


def test_an_aggregate_dataset_keeps_its_weighted_mean_column_names(tmp_path):
    """A formulation-level model must be fitted on `wavg_*` columns and report them back, so a
    prediction built the same way lines up with it."""
    dataset = build_dataset(
        tmp_path,
        30,
        feature_order=("wavg_rdkit_MolWt", "wavg_rdkit_MolLogP", "total_additive_concentration"),
    )
    # Rewrite the rows under the aggregate column names the Rust side produces.
    document = json.loads(dataset.read_text(encoding="utf-8"))
    document["dataset_mode"] = "formulation_aggregate"
    for row in document["rows"]:
        features = row["features"]
        row["features"] = {
            "wavg_rdkit_MolWt": features["rdkit_MolWt"],
            "wavg_rdkit_MolLogP": features["rdkit_MolLogP"],
            "total_additive_concentration": features["concentration"],
        }
    dataset.write_text(json.dumps(document), encoding="utf-8")
    model_path = tmp_path / "aggregate.joblib"

    result, _ = train_model({"dataset_path": str(dataset), "model_path": str(model_path)})

    assert result["dataset_mode"] == "formulation_aggregate"
    assert result["feature_order"] == [
        "wavg_rdkit_MolWt",
        "wavg_rdkit_MolLogP",
        "total_additive_concentration",
    ]

    predicted, _ = predict_with_model(
        {
            "model_path": str(model_path),
            "feature_schema_version": "2",
            "items": [
                {
                    "id": "form-1",
                    "label": "Blend",
                    "features": {
                        "wavg_rdkit_MolWt": 400.0,
                        "wavg_rdkit_MolLogP": 4.0,
                        "total_additive_concentration": 4.0,
                    },
                }
            ],
        }
    )
    assert predicted["dataset_mode"] == "formulation_aggregate"
    assert len(predicted["predictions"]) == 1
