"""SHAP attributions for the saved prediction pipeline, entirely offline."""

from __future__ import annotations

from typing import Any

from ..utils.errors import ExplanationReferenceError
from .ml_service import _require_sklearn, feature_matrix, load_bundle

BACKGROUND_LIMIT = 64
EXPLANATION_LIMIT = 50
SEED = 42


def explain_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    import shap

    np = _require_sklearn()["np"]
    bundle = load_bundle(payload["model_path"], payload.get("feature_schema_version"))
    reference = bundle.get("explanation_reference")
    if not isinstance(reference, dict) or reference.get("version") != 1:
        raise ExplanationReferenceError("This model has no saved SHAP reference data. Retrain it with this version of LMD before requesting an explanation.")
    names = list(bundle["feature_order"])
    reference_matrix = np.asarray(reference["matrix"], dtype=float)
    if reference_matrix.ndim != 2 or reference_matrix.shape[1] != len(names) or not len(reference_matrix):
        raise ValueError("The saved SHAP reference has incompatible feature dimensions. Retrain the model.")
    if len(reference.get("items", [])) != len(reference_matrix):
        raise ValueError("The saved SHAP reference labels do not match its rows. Retrain the model.")
    rng = np.random.default_rng(SEED)
    background_indices = sorted(rng.choice(len(reference_matrix), min(BACKGROUND_LIMIT, len(reference_matrix)), replace=False).tolist())
    items = payload.get("items") or []
    cohort = "selected_molecules" if items else "training_reference"
    total = len(items) if items else int(reference["total_count"])
    source = feature_matrix(bundle, items) if items else reference_matrix
    source_items = items if items else reference["items"]
    indices = sorted(rng.choice(len(source), min(EXPLANATION_LIMIT, len(source)), replace=False).tolist())
    matrix = source[indices]
    pipeline = bundle["pipeline"]
    # Explain the very same imputation/scaling/estimator used for prediction. Each
    # retained input column maps to exactly one transformed column in our pipelines.
    background = pipeline[:-1].transform(reference_matrix[background_indices])
    transformed = pipeline[:-1].transform(matrix)
    if transformed.shape[1] != len(names) or not np.isfinite(transformed).all() or not np.isfinite(background).all():
        raise ValueError("The model preprocessing is not compatible with per-variable SHAP explanations.")
    estimator = pipeline.named_steps["model"]
    algorithm = bundle["algorithm"]
    if algorithm == "ridge":
        explainer = shap.LinearExplainer(estimator, shap.maskers.Independent(background, max_samples=len(background)))
        method = "LinearExplainer / independent"
        background_kind = "sampled_reference"
        background_count = len(background)
    elif algorithm in {"random_forest", "hist_gradient_boosting"}:
        # Tree-path SHAP uses the fitted trees' training cover counts. Do not
        # label those counts as the sampled background used by LinearExplainer.
        explainer = shap.TreeExplainer(estimator, feature_perturbation="tree_path_dependent", model_output="raw")
        method = "TreeExplainer / tree_path_dependent"
        background_kind = "tree_path_counts"
        background_count = 0
    else:
        raise ValueError(f"SHAP is not supported for algorithm {algorithm!r}.")
    explanation = explainer(transformed)
    values = np.asarray(explanation.values, dtype=float)
    bases = np.broadcast_to(np.asarray(explanation.base_values, dtype=float).reshape(-1), (len(matrix),))
    predictions = np.asarray(pipeline.predict(matrix), dtype=float)
    if values.shape != transformed.shape or not np.isfinite(values).all() or not np.isfinite(bases).all() or not np.isfinite(predictions).all():
        raise ValueError("SHAP returned invalid values; no explanation was produced.")
    reconstructed = bases + values.sum(axis=1)
    if not np.allclose(reconstructed, predictions, rtol=1e-5, atol=1e-7):
        raise ValueError("SHAP contributions do not reconstruct the pipeline predictions; no explanation was produced.")
    importance = np.abs(values).mean(axis=0)
    return {
        "mode": "real", "method": method, "shap_version": shap.__version__,
        "target": bundle["target"], "algorithm": algorithm,
        "feature_schema_version": bundle["feature_schema_version"],
        "cohort": cohort, "total_count": total, "sample_count": len(matrix),
        "reference_count": len(reference_matrix), "background_count": background_count, "background_kind": background_kind, "seed": SEED,
        "feature_names": names,
        "importance": [{"feature": names[i], "mean_abs_shap": float(importance[i])} for i in np.argsort(-importance, kind="stable")],
        "samples": [{
            "id": str(source_items[index].get("id", index)),
            "label": str(source_items[index].get("label", index)),
            "prediction": float(predictions[position]), "base_value": float(bases[position]),
            "shap_values": values[position].tolist(),
            # Raw feature values remain in their original units; null means the saved
            # imputer supplied a value. Never present standardized z-scores as raw values.
            "feature_values": [float(value) if np.isfinite(value) else None for value in matrix[position]],
        } for position, index in enumerate(indices)],
    }, []
