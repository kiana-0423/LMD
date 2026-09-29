"""Train/predict with the real Python service on synthetic labels in /tmp only."""
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "python-sidecar"))
from lmd_sidecar.services.ml_service import train_model, predict_with_model

temporary = Path("/tmp/lmd-generated-demo-pipeline")
checks = []
for mode in ("additive_component", "formulation_aggregate"):
    path = temporary / f"{mode}.json"
    dataset = json.loads(path.read_text())
    model = temporary / f"SYNTHETIC-NOT-REAL-{mode}.joblib"
    trained, warnings = train_model({"dataset_path": str(path), "model_path": str(model), "algorithm": "random_forest"})
    assert trained["sample_count"] == len(dataset["rows"])
    assert trained["group_count"] >= 5
    assert trained["validated"] is True, trained
    # Complete examples identified by the Rust prediction path; never fill missing descriptors.
    ready_ids = set(dataset["prediction_ready_ids"])
    items = [row for row in dataset["rows"] if row["id"] in ready_ids][:3]
    predicted, prediction_warnings = predict_with_model({"model_path": str(model), "items": items,
                                                        "feature_schema_version": dataset["feature_schema_version"]})
    assert len(predicted["predictions"]) == len(items) == 3
    assert all(math.isfinite(p["value"]) for p in predicted["predictions"])
    checks.append({"data_origin": "synthetic", "is_real": False, "batch_id": "SYNTH-DEMO-20260928-01",
                   "dataset_mode": mode, "target": dataset["target"], "training_samples": trained["sample_count"],
                   "feature_count": trained["feature_count"], "independent_groups": trained["group_count"],
                   "split_method": trained["split_method"], "software_training_and_prediction_passed": True,
                   "notice": "This checks software execution on generated data, not real-world predictive validity.",
                   "models_saved_only_in_temporary_directory": str(model),
                   "example_predictions": predicted["predictions"], "warnings": warnings + prediction_warnings})
(Path(__file__).parent / "training-checks.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2))
print(json.dumps([{k:v for k,v in c.items() if k not in ("example_predictions", "warnings")} for c in checks]))
