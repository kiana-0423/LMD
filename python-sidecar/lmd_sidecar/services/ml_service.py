"""Offline training and prediction.

Everything runs locally against the workspace: the caller hands over a dataset extracted from
SQLite, a model is fitted with scikit-learn, and the fitted pipeline is written next to the
workspace so a later prediction can load it back. Nothing here fabricates a result — when the
data is too small or a feature is missing the caller gets an error explaining what is needed.

Validation is designed for the question a designer asks — *how well does this model predict a
molecule it has never seen?* — rather than the easier one of predicting a repeat measurement:

  * Observations of one molecule stay together on one side of the split, and so do observations
    of one formulation. The two relations are linked (a formulation holds molecules; a molecule
    appears in formulations), so the groups are the connected components of that graph. A
    molecule that appears in three formulations, each measured twice, is one group of six rows.
  * Imputation and scaling are fitted inside the pipeline, on the training side only.
  * The held-out score is reported with the number of independent molecules it was measured on,
    not only the number of rows.
  * Too few independent groups is reported as *no validation*, not as a validation of one.
"""

from __future__ import annotations

import json
import platform
from pathlib import Path
from typing import Any

from ..utils.messages import (
    TRAINING_DROPPED_FEATURES,
    TRAINING_FORMULATION_GROUPS_ONLY,
    TRAINING_NOT_SCOREABLE,
    TRAINING_SMALL_SAMPLE,
    TRAINING_TOO_FEW_GROUPS,
    TRAINING_UNGROUPED_SPLIT,
    message,
)

MODEL_FORMAT_VERSION = "1"

# Below this a fitted model would describe noise, so training refuses instead.
MIN_TRAINING_SAMPLES = 12
# Only above this is there enough data to hold rows back and still fit something.
MIN_SAMPLES_FOR_VALIDATION = 20
# With a quarter held out, fewer independent groups than this leaves at most one group on the
# validation side — and the error measured on one molecule's repeats says nothing about how the
# model treats a molecule it has not seen. Below it, validation is reported as unavailable.
MIN_GROUPS_FOR_VALIDATION = 5

SPLIT_LINKED = "GroupShuffleSplit(test_size=0.25, random_state=42) grouped by linked molecules and formulations"
SPLIT_FORMULATION = "GroupShuffleSplit(test_size=0.25, random_state=42) grouped by formulation"
SPLIT_UNGROUPED = "train_test_split(test_size=0.25, random_state=42), ungrouped"


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


def _row_molecule_ids(row: dict[str, Any]) -> list[str]:
    """Every molecule a row describes: one for an additive-component row, several for an aggregate."""
    ids: list[str] = []
    single = str(row.get("molecule_id") or "")
    if single:
        ids.append(single)
    for item in row.get("molecule_ids") or []:
        text = str(item or "")
        if text and text not in ids:
            ids.append(text)
    return ids


def leakage_groups(rows: list[dict[str, Any]]) -> tuple[list[str], str]:
    """One group id per row such that rows sharing a molecule or a formulation share a group.

    Returns the ids and how they were formed: `linked` when molecule ids took part, `formulation`
    when only formulation ids were available, `none` when neither was.
    """
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        while parent.setdefault(key, key) != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(a: str, b: str) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    any_molecule = False
    any_formulation = False
    row_keys: list[list[str]] = []
    for index, row in enumerate(rows):
        keys: list[str] = []
        formulation = str(row.get("group_id") or "")
        if formulation:
            keys.append(f"f:{formulation}")
            any_formulation = True
        for molecule in _row_molecule_ids(row):
            keys.append(f"m:{molecule}")
            any_molecule = True
        if not keys:
            keys.append(f"r:{index}")
        for key in keys[1:]:
            union(keys[0], key)
        row_keys.append(keys)

    groups = [find(keys[0]) for keys in row_keys]
    if any_molecule:
        grouping = "linked"
    elif any_formulation:
        grouping = "formulation"
    else:
        grouping = "none"
    return groups, grouping


def _domain_summary(
    np: Any,
    rows: list[dict[str, Any]],
    feature_order: list[str],
    features: Any,
    targets: Any,
) -> dict[str, Any]:
    """What the fitted model has seen, recorded so a later candidate can be placed against it.

    Feature ranges are the training minimum and maximum of each column; training molecules are
    kept by id, label and SMILES so a candidate's nearest neighbours can be named; conditions are
    the experimental context the rows carried. None of this is a threshold — it is the evidence a
    reader needs to judge whether a prediction is an interpolation or a reach.
    """
    ranges: dict[str, list[float]] = {}
    for index, name in enumerate(feature_order):
        column = features[:, index]
        finite = column[np.isfinite(column)]
        if finite.size:
            ranges[name] = [float(finite.min()), float(finite.max())]

    molecules: dict[str, dict[str, Any]] = {}
    for row in rows:
        smiles = str(row.get("smiles") or "")
        for molecule_id in _row_molecule_ids(row):
            entry = molecules.setdefault(
                molecule_id, {"id": molecule_id, "label": str(row.get("label") or ""), "smiles": "", "rows": 0}
            )
            entry["rows"] += 1
            if smiles and not entry["smiles"]:
                entry["smiles"] = smiles

    test_types: dict[str, int] = {}
    base_oils: dict[str, dict[str, Any]] = {}
    concentrations: list[float] = []
    temperatures: dict[str, list[float]] = {}
    loads: dict[str, list[float]] = {}
    single_additive_rows = 0
    for row in rows:
        conditions = row.get("conditions") or {}
        test_type = str(conditions.get("test_type") or "")
        if test_type:
            test_types[test_type] = test_types.get(test_type, 0) + 1
        for oil in conditions.get("base_oils") or []:
            oil_id = str(oil.get("id") or "")
            if not oil_id:
                continue
            entry = base_oils.setdefault(oil_id, {"id": oil_id, "name": str(oil.get("name") or ""), "rows": 0})
            entry["rows"] += 1
        concentration = row.get("features", {}).get("concentration")
        if isinstance(concentration, (int, float)) and not isinstance(concentration, bool) and concentration == concentration:
            concentrations.append(float(concentration))
        for key, store in (("temperature", temperatures), ("load", loads)):
            value = conditions.get(f"{key}_value")
            unit = str(conditions.get(f"{key}_unit") or "")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value:
                store.setdefault(unit, []).append(float(value))
        if conditions.get("additive_count") == 1:
            single_additive_rows += 1

    finite_targets = targets[np.isfinite(targets)]
    return {
        "recorded": True,
        "feature_ranges": ranges,
        "training_molecules": sorted(molecules.values(), key=lambda item: item["id"]),
        "molecule_count": len(molecules),
        "row_count": int(len(rows)),
        "target_range": [float(finite_targets.min()), float(finite_targets.max())] if finite_targets.size else None,
        "conditions": {
            "test_types": test_types,
            "base_oils": sorted(base_oils.values(), key=lambda item: item["id"]),
            "concentration_range": [min(concentrations), max(concentrations)] if concentrations else None,
            "temperature_ranges": {unit: [min(values), max(values)] for unit, values in temperatures.items()},
            "load_ranges": {unit: [min(values), max(values)] for unit, values in loads.items()},
            "single_additive_rows": single_additive_rows,
        },
    }


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
    kept_rows = [row for row, keep in zip(rows, finite_targets) if keep]
    excluded = len(rows) - int(finite_targets.sum())
    if len(targets) < minimum:
        raise InsufficientDataError(
            f"Training '{target}' needs at least {minimum} records with a measured value; only "
            f"{len(targets)} of {len(rows)} rows have one."
        )

    # A column that is entirely missing carries no signal and would only add imputation noise.
    # This looks at presence only, never at the target, so it cannot leak label information into
    # the validation split.
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
        # Median imputation is deterministic and survives round-tripping through joblib. Fitted
        # inside the pipeline, so during validation it sees the training side only.
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

    # Repeated runs of one formulation, and repeated appearances of one molecule, are not
    # independent samples. Whole linked groups are held out so neither can straddle the split.
    groups, grouping = leakage_groups(kept_rows)
    distinct_groups = len(set(groups))
    has_groups = grouping != "none" and distinct_groups > 1
    molecule_ids = {molecule for row in kept_rows for molecule in _row_molecule_ids(row)}
    split_method = "none"

    metrics: dict[str, Any] = {}
    validation_unavailable_reason = ""
    if len(targets) >= MIN_SAMPLES_FOR_VALIDATION and has_groups and distinct_groups < MIN_GROUPS_FOR_VALIDATION:
        validation_unavailable_reason = "too_few_groups"
        warnings.append(
            message(
                TRAINING_TOO_FEW_GROUPS,
                f"The dataset holds {len(targets)} records but only {distinct_groups} independent "
                f"molecule/formulation group(s); at least {MIN_GROUPS_FOR_VALIDATION} are needed to hold "
                "whole groups out. No held-out validation was possible, so the reported metrics are "
                "in-sample.",
                groups=distinct_groups,
                required=MIN_GROUPS_FOR_VALIDATION,
            )
        )

    if len(targets) >= MIN_SAMPLES_FOR_VALIDATION and not validation_unavailable_reason:
        if has_groups:
            splitter = tools["GroupShuffleSplit"](n_splits=1, test_size=0.25, random_state=42)
            train_index, valid_index = next(splitter.split(features, targets, groups=groups))
            split_method = SPLIT_LINKED if grouping == "linked" else SPLIT_FORMULATION
            if grouping == "formulation":
                warnings.append(
                    message(
                        TRAINING_FORMULATION_GROUPS_ONLY,
                        "The dataset carries formulation ids but no molecule ids, so a molecule that "
                        "appears in several formulations may sit on both sides of the split. The "
                        "validation score describes repeat formulations better than unseen molecules.",
                    )
                )
        else:
            train_index, valid_index = tools["train_test_split"](
                np.arange(len(targets)), test_size=0.25, random_state=42
            )
            split_method = SPLIT_UNGROUPED
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
            held_out_rows = [kept_rows[index] for index in valid_index]
            scored["molecule_count"] = len(
                {molecule for row in held_out_rows for molecule in _row_molecule_ids(row)}
            )
            scored["group_count"] = len({groups[index] for index in valid_index})
            scored["grouping"] = grouping
            metrics = {"validation": scored}
            # Refit on everything so the saved model uses all available evidence.
            pipeline.fit(features, targets)
    else:
        split_method = "none (in-sample metrics only)"
        pipeline.fit(features, targets)
        fitted = pipeline.predict(features)
        in_sample = _score(tools, np, targets, fitted)
        metrics = {"training_only": in_sample} if in_sample else {}
        if not validation_unavailable_reason:
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

    domain = _domain_summary(np, kept_rows, feature_order, features, targets)
    domain["split_grouping"] = grouping
    domain["leakage_group_count"] = distinct_groups
    domain["validation"] = metrics.get("validation")
    domain["dataset_scope"] = dataset.get("dataset_scope") or {}

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
        "domain": domain,
    }
    # A bounded, reproducible reference from the exact rows/columns fitted here.
    # Never reconstruct an explanation background from a subsequently edited database.
    reference_indices = sorted(np.random.default_rng(42).choice(len(features), min(200, len(features)), replace=False).tolist())
    bundle["explanation_reference"] = {
        "version": 1,
        "seed": 42,
        "total_count": len(features),
        "matrix": features[reference_indices],
        "items": [{"id": str(kept_rows[i].get("id", i)), "label": str(kept_rows[i].get("label", i))} for i in reference_indices],
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
        "group_count": distinct_groups if has_groups else 0,
        "molecule_count": len(molecule_ids),
        "split_grouping": grouping,
        "split_method": split_method,
        "validation_unavailable_reason": validation_unavailable_reason,
        "dataset_mode": str(dataset.get("dataset_mode") or "additive_component"),
        "interpretation": str(dataset.get("interpretation") or ""),
        "feature_schema_version": str(dataset.get("feature_schema_version") or "unknown"),
        "concentration_basis": str(dataset.get("concentration_basis") or "unknown"),
        "validated": "validation" in metrics,
        "feature_count": len(feature_order),
        "feature_order": feature_order,
        "dropped_features": dropped_features,
        "metrics": metrics,
        "domain_summary": {
            "molecule_count": domain["molecule_count"],
            "conditions": domain["conditions"],
            "target_range": domain["target_range"],
        },
        "sklearn_version": tools["sklearn_version"],
    }, warnings


def load_bundle(model_path: str | Path, expected_schema: Any = None) -> dict[str, Any]:
    """Loads a fitted bundle and refuses one this build cannot answer for."""
    tools = _require_sklearn()
    model_path = Path(model_path)
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
    stored_schema = str(bundle.get("feature_schema_version", "unknown"))
    if expected_schema is not None and str(expected_schema) != stored_schema:
        raise ValueError(
            f"This model was fitted under feature schema {stored_schema}, but the caller builds "
            f"features under schema {expected_schema}. The columns no longer mean the same thing; "
            "retrain the model."
        )
    return bundle


def feature_matrix(bundle: dict[str, Any], items: list[dict[str, Any]]):
    """Orders each item's features as the model expects, refusing any gap."""
    np = _require_sklearn()["np"]
    feature_order: list[str] = list(bundle["feature_order"])
    if not items:
        raise ValueError("Prediction requires at least one item.")
    rows = []
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
    return np.array(rows, dtype="float64")


def predict_with_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    bundle = load_bundle(payload["model_path"], payload.get("feature_schema_version"))
    items = payload.get("items") or []
    matrix = feature_matrix(bundle, items)
    predictions = bundle["pipeline"].predict(matrix)
    return {
        "mode": "real",
        "target": bundle.get("target", ""),
        "algorithm": bundle.get("algorithm", ""),
        "model_version": bundle.get("format_version", ""),
        "dataset_mode": bundle.get("dataset_mode", "unknown"),
        "feature_schema_version": bundle.get("feature_schema_version", "unknown"),
        "concentration_basis": bundle.get("concentration_basis", "unknown"),
        "feature_count": len(bundle["feature_order"]),
        "predictions": [
            {
                "id": str(items[index].get("id", "")),
                "label": str(items[index].get("label", "")),
                "value": float(value),
            }
            for index, value in enumerate(predictions)
        ],
    }, []


def describe_model(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    tools = _require_sklearn()
    model_path = Path(payload["model_path"])
    if not model_path.is_file():
        raise FileNotFoundError(f"Trained model not found at {model_path}.")
    bundle = tools["joblib"].load(model_path)
    domain = bundle.get("domain") or {}
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
        "domain_recorded": bool(domain.get("recorded")),
        "molecule_count": domain.get("molecule_count", 0),
        "split_grouping": domain.get("split_grouping", "unknown"),
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
