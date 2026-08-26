"""Offline training and prediction.

Everything runs locally against the workspace: the caller hands over a dataset extracted from
SQLite, a model is fitted with scikit-learn, and the fitted pipeline is written next to the
workspace so a later prediction can load it back. Nothing here fabricates a result — when the
data is too small or a feature is missing the caller gets an error explaining what is needed.
"""

from __future__ import annotations

import json
import platform
from pathlib import Path
from typing import Any

from ..utils.messages import (
    TRAINING_DROPPED_FEATURES,
    TRAINING_NOT_SCOREABLE,
    TRAINING_SMALL_SAMPLE,
    TRAINING_UNGROUPED_SPLIT,
    message,
)

MODEL_FORMAT_VERSION = "1"

# Below this a fitted model would describe noise, so training refuses instead.
MIN_TRAINING_SAMPLES = 12
# Only above this is there enough data to hold rows back and still fit something.
MIN_SAMPLES_FOR_VALIDATION = 20


class InsufficientDataError(RuntimeError):
    """Raised when a request cannot be answered honestly from the data available."""


def _require_sklearn():
    try:
        import joblib
        import numpy as np
        import sklearn
        from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import Ridge
        from sklearn.metrics import mean_absolute_error, r2_score
        from sklearn.model_selection import GroupShuffleSplit, train_test_split
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        return {
            "joblib": joblib,
            "np": np,
            "sklearn_version": sklearn.__version__,
            "HistGradientBoostingRegressor": HistGradientBoostingRegressor,
            "RandomForestRegressor": RandomForestRegressor,
            "Ridge": Ridge,
            "SimpleImputer": SimpleImputer,
            "StandardScaler": StandardScaler,
            "Pipeline": Pipeline,
            "train_test_split": train_test_split,
            "GroupShuffleSplit": GroupShuffleSplit,
            "mean_absolute_error": mean_absolute_error,
            "r2_score": r2_score,
        }
    except Exception as exc:  # pragma: no cover - depends on the packaged environment
        raise RuntimeError(
            f"scikit-learn and joblib are required for model training and prediction: {exc}"
        ) from exc


def _select_algorithm(requested: str, sample_count: int, tools: dict[str, Any]):
    """Chooses a baseline that suits the sample size unless the caller named one."""
    requested = (requested or "auto").lower()
    if requested == "auto":
        # Ridge is the stable choice for the small datasets a new workspace produces.
        requested = "ridge" if sample_count < 40 else "random_forest"
    if requested in {"ridge", "linear"}:
        return "ridge", tools["Ridge"](alpha=1.0)
    if requested in {"random_forest", "randomforestregressor"}:
        return "random_forest", tools["RandomForestRegressor"](
            n_estimators=200, random_state=42, n_jobs=1
        )
    if requested in {"hist_gradient_boosting", "histgradientboostingregressor"}:
        return "hist_gradient_boosting", tools["HistGradientBoostingRegressor"](random_state=42)
    raise ValueError(
        f"Unsupported algorithm '{requested}'. Use auto, ridge, random_forest, or "
        "hist_gradient_boosting."
    )


def _read_dataset(dataset_path: str) -> dict[str, Any]:
    path = Path(dataset_path)
    if not path.is_file():
        raise FileNotFoundError(f"Training dataset not found: {path}")
    with path.open("r", encoding="utf-8") as stream:
        dataset = json.load(stream)
    if not isinstance(dataset, dict):
        raise ValueError("The training dataset must be a JSON object.")
    return dataset


def train_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    tools = _require_sklearn()
    np = tools["np"]

    dataset = _read_dataset(payload["dataset_path"])
    rows: list[dict[str, Any]] = dataset.get("rows") or []
    feature_order: list[str] = list(dataset.get("feature_order") or [])
    target = str(dataset.get("target") or payload.get("target") or "")
    if not target:
        raise ValueError("The training dataset must name a target column.")
    if not feature_order:
        raise InsufficientDataError(
            "The training dataset contains no numeric feature columns. Calculate real RDKit or "
            "Mordred descriptors for the molecules used in your experiments, then try again."
        )

    minimum = int(payload.get("min_samples") or MIN_TRAINING_SAMPLES)
    if len(rows) < minimum:
        raise InsufficientDataError(
            f"Training '{target}' needs at least {minimum} complete records; the workspace "
            f"provides {len(rows)}. Add more experiments with measured results, or calculate "
            "descriptors for the molecules that are already linked to results."
        )

    features = np.array(
        [[_as_float(row.get("features", {}).get(name)) for name in feature_order] for row in rows],
        dtype="float64",
    )
    targets = np.array([_as_float(row.get("target")) for row in rows], dtype="float64")
    finite_targets = np.isfinite(targets)
    features = features[finite_targets]
    targets = targets[finite_targets]
    excluded = len(rows) - int(finite_targets.sum())
    if len(targets) < minimum:
        raise InsufficientDataError(
            f"Training '{target}' needs at least {minimum} records with a measured value; only "
            f"{len(targets)} of {len(rows)} rows have one."
        )

    # A column that is entirely missing carries no signal and would only add imputation noise.
    usable = [
        index for index in range(features.shape[1]) if np.isfinite(features[:, index]).any()
    ]
    dropped_features = [feature_order[index] for index in range(len(feature_order)) if index not in usable]
    features = features[:, usable]
    feature_order = [feature_order[index] for index in usable]
    if not feature_order:
        raise InsufficientDataError(
            "Every candidate feature is missing for the selected records, so there is nothing to "
            "train on."
        )

    algorithm, estimator = _select_algorithm(
        str(payload.get("algorithm") or "auto"), len(targets), tools
    )
    steps = [
        # Median imputation is deterministic and survives round-tripping through joblib.
        ("impute", tools["SimpleImputer"](strategy="median")),
    ]
    if algorithm == "ridge":
        steps.append(("scale", tools["StandardScaler"]()))
    steps.append(("model", estimator))
    pipeline = tools["Pipeline"](steps)

    warnings: list[dict[str, Any]] = []
    if dropped_features:
        # The feature names are the user's own descriptor columns and are never translated.
        named = ", ".join(dropped_features[:10]) + ("..." if len(dropped_features) > 10 else "")
        warnings.append(
            message(
                TRAINING_DROPPED_FEATURES,
                f"{len(dropped_features)} feature(s) were dropped because no record had a value: {named}",
                count=len(dropped_features),
                features=named,
            )
        )

    # Repeated runs of one formulation are not independent samples. When the caller supplies
    # group ids, hold out whole groups so the same mixture cannot appear on both sides of the
    # split and inflate the score.
    groups = [str(row.get("group_id") or "") for row in rows]
    groups = [group for group, keep in zip(groups, finite_targets) if keep]
    has_groups = bool(groups) and any(groups) and len(set(groups)) > 1
    split_method = "none"

    metrics: dict[str, Any] = {}
    if len(targets) >= MIN_SAMPLES_FOR_VALIDATION:
        if has_groups:
            splitter = tools["GroupShuffleSplit"](n_splits=1, test_size=0.25, random_state=42)
            train_index, valid_index = next(splitter.split(features, targets, groups=groups))
            split_method = "GroupShuffleSplit(test_size=0.25, random_state=42) grouped by formulation"
        else:
            train_index, valid_index = tools["train_test_split"](
                np.arange(len(targets)), test_size=0.25, random_state=42
            )
            split_method = "train_test_split(test_size=0.25, random_state=42), ungrouped"
            warnings.append(
                message(
                    TRAINING_UNGROUPED_SPLIT,
                    "The dataset carries no group ids, so repeated measurements of one formulation "
                    "may appear in both the training and validation sets. Treat the validation score "
                    "as optimistic.",
                )
            )
        x_train, x_valid = features[train_index], features[valid_index]
        y_train, y_valid = targets[train_index], targets[valid_index]
        pipeline.fit(x_train, y_train)
        predicted = pipeline.predict(x_valid)
        scored = _score(tools, np, y_valid, predicted)
        if scored is None:
            # R2 is undefined for one observation or a constant target. Reporting NaN would
            # produce invalid JSON and look like a computed number.
            warnings.append(
                message(
                    TRAINING_NOT_SCOREABLE,
                    f"The validation split held out {len(y_valid)} record(s) with "
                    f"{len(set(y_valid.tolist()))} distinct target value(s), which is not enough to "
                    "score. In-sample metrics are reported instead.",
                    heldOut=len(y_valid),
                    distinct=len(set(y_valid.tolist())),
                )
            )
            pipeline.fit(features, targets)
            fitted = pipeline.predict(features)
            in_sample = _score(tools, np, targets, fitted)
            metrics = {"training_only": in_sample} if in_sample else {}
            split_method += " (not scoreable; fell back to in-sample metrics)"
        else:
            metrics = {"validation": scored}
            # Refit on everything so the saved model uses all available evidence.
            pipeline.fit(features, targets)
    else:
        split_method = "none (in-sample metrics only)"
        pipeline.fit(features, targets)
        fitted = pipeline.predict(features)
        in_sample = _score(tools, np, targets, fitted)
        metrics = {"training_only": in_sample} if in_sample else {}
        warnings.append(
            message(
                TRAINING_SMALL_SAMPLE,
                f"Only {len(targets)} records were available, below the {MIN_SAMPLES_FOR_VALIDATION} "
                "needed to hold out a validation split. The reported metrics are in-sample and will "
                "overstate accuracy.",
                available=len(targets),
                required=MIN_SAMPLES_FOR_VALIDATION,
            )
        )

    model_path = Path(payload["model_path"])
    model_path.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        "format_version": MODEL_FORMAT_VERSION,
        "pipeline": pipeline,
        "feature_order": feature_order,
        "target": target,
        "algorithm": algorithm,
        "split_method": split_method,
        "dataset_mode": str(dataset.get("dataset_mode") or "additive_component"),
        "interpretation": str(dataset.get("interpretation") or ""),
        # The feature definition and the concentration basis travel with the fitted pipeline, so a
        # later prediction can be refused rather than computed from differently-defined columns.
        "feature_schema_version": str(dataset.get("feature_schema_version") or "unknown"),
        "concentration_basis": str(dataset.get("concentration_basis") or "unknown"),
        "sklearn_version": tools["sklearn_version"],
        "python_version": platform.python_version(),
    }
    tools["joblib"].dump(bundle, model_path)

    return {
        "mode": "real",
        "model_path": str(model_path),
        "target": target,
        "task": "regression",
        "algorithm": algorithm,
        "model_version": MODEL_FORMAT_VERSION,
        "sample_count": int(len(targets)),
        "excluded_count": int(excluded),
        "group_count": len(set(groups)) if has_groups else 0,
        "split_method": split_method,
        "dataset_mode": str(dataset.get("dataset_mode") or "additive_component"),
        "interpretation": str(dataset.get("interpretation") or ""),
        "feature_schema_version": str(dataset.get("feature_schema_version") or "unknown"),
        "concentration_basis": str(dataset.get("concentration_basis") or "unknown"),
        "validated": "validation" in metrics,
        "feature_count": len(feature_order),
        "feature_order": feature_order,
        "dropped_features": dropped_features,
        "metrics": metrics,
        "sklearn_version": tools["sklearn_version"],
    }, warnings


def predict_with_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    tools = _require_sklearn()
    np = tools["np"]

    model_path = Path(payload["model_path"])
    if not model_path.is_file():
        raise FileNotFoundError(
            f"Trained model not found at {model_path}. Train a model for this target first."
        )
    bundle = tools["joblib"].load(model_path)
    if not isinstance(bundle, dict) or "pipeline" not in bundle:
        raise ValueError(f"{model_path} is not an LMD model bundle.")
    if str(bundle.get("format_version")) != MODEL_FORMAT_VERSION:
        raise ValueError(
            f"Model {model_path} uses format version {bundle.get('format_version')}, but this "
            f"build reads version {MODEL_FORMAT_VERSION}. Retrain the model."
        )

    expected_schema = payload.get("feature_schema_version")
    stored_schema = str(bundle.get("feature_schema_version", "unknown"))
    if expected_schema is not None and str(expected_schema) != stored_schema:
        raise ValueError(
            f"This model was fitted under feature schema {stored_schema}, but the caller builds "
            f"features under schema {expected_schema}. The columns no longer mean the same thing; "
            "retrain the model."
        )

    feature_order: list[str] = list(bundle["feature_order"])
    items = payload.get("items") or []
    if not items:
        raise ValueError("Prediction requires at least one item.")

    rows = []
    warnings: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        features = item.get("features") or {}
        # A missing feature would silently become an imputed median and look like a real input.
        missing = [name for name in feature_order if name not in features]
        if missing:
            raise ValueError(
                f"Item {index + 1} ({item.get('id', 'unnamed')}) is missing {len(missing)} "
                f"feature(s) the model requires: {', '.join(missing[:10])}"
                + ("..." if len(missing) > 10 else "")
            )
        rows.append([_as_float(features.get(name)) for name in feature_order])

    matrix = np.array(rows, dtype="float64")
    predictions = bundle["pipeline"].predict(matrix)
    return {
        "mode": "real",
        "target": bundle.get("target", ""),
        "algorithm": bundle.get("algorithm", ""),
        "model_version": bundle.get("format_version", ""),
        "dataset_mode": bundle.get("dataset_mode", "unknown"),
        "feature_schema_version": bundle.get("feature_schema_version", "unknown"),
        "concentration_basis": bundle.get("concentration_basis", "unknown"),
        "feature_count": len(feature_order),
        "predictions": [
            {
                "id": str(items[index].get("id", "")),
                "label": str(items[index].get("label", "")),
                "value": float(value),
            }
            for index, value in enumerate(predictions)
        ],
    }, warnings


def describe_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    tools = _require_sklearn()
    model_path = Path(payload["model_path"])
    if not model_path.is_file():
        raise FileNotFoundError(f"Trained model not found at {model_path}.")
    bundle = tools["joblib"].load(model_path)
    return {
        "mode": "real",
        "target": bundle.get("target", ""),
        "algorithm": bundle.get("algorithm", ""),
        "model_version": bundle.get("format_version", ""),
        "split_method": bundle.get("split_method", "unknown"),
        "dataset_mode": bundle.get("dataset_mode", "unknown"),
        "feature_schema_version": bundle.get("feature_schema_version", "unknown"),
        "concentration_basis": bundle.get("concentration_basis", "unknown"),
        "interpretation": bundle.get("interpretation", ""),
        "feature_order": list(bundle.get("feature_order", [])),
        "sklearn_version": bundle.get("sklearn_version", ""),
        "python_version": bundle.get("python_version", ""),
    }, []


def _score(tools: dict[str, Any], np: Any, actual: Any, predicted: Any) -> dict[str, Any] | None:
    """Regression metrics, or ``None`` when the sample cannot support them.

    R2 needs at least two observations and a target that actually varies; anything else yields
    NaN, which is neither valid JSON nor a meaningful score.
    """
    if len(actual) < 2:
        return None
    if float(np.ptp(actual)) == 0.0:
        return None
    r2 = float(tools["r2_score"](actual, predicted))
    mae = float(tools["mean_absolute_error"](actual, predicted))
    rmse = float(np.sqrt(np.mean((actual - predicted) ** 2)))
    if not all(np.isfinite([r2, mae, rmse])):
        return None
    return {
        "sample_count": int(len(actual)),
        "r2": r2,
        "mae": mae,
        "rmse": rmse,
    }


def _as_float(value: Any) -> float:
    """Anything that is not a finite number becomes NaN so the imputer can handle it."""
    if value is None or isinstance(value, bool):
        return float("nan")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float("nan")
    return number if number == number and abs(number) != float("inf") else float("nan")
