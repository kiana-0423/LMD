"""Bounded plots from the exact predictions used for evaluation, before any final refit."""
from __future__ import annotations

from typing import Any

MAX_DIAGNOSTIC_POINTS = 1000


def training_provenance(dataset: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    synthetic_count = 0
    batches = set()
    for row in rows:
        source = row.get("provenance") or dataset
        if source.get("data_origin") == "synthetic" or source.get("is_real") is False:
            synthetic_count += 1
            if source.get("batch_id"):
                batches.add(str(source["batch_id"]))
    return {"synthetic_count": synthetic_count, "total_count": len(rows),
            "unmarked_count": len(rows) - synthetic_count, "batch_ids": sorted(batches)}


def evaluation_diagnostics(np, rows, actual, predicted, cohort, provenance):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if len(rows) != len(actual) or actual.shape != predicted.shape or not len(rows):
        raise ValueError("Evaluation predictions must align with the evaluated rows.")
    if not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise ValueError("Evaluation predictions must be finite.")
    residuals = predicted - actual
    indices = sorted(np.random.default_rng(42).choice(
        len(rows), min(MAX_DIAGNOSTIC_POINTS, len(rows)), replace=False).tolist())
    points = [{"id": str(rows[i].get("id", i)), "label": str(rows[i].get("label", rows[i].get("id", i))),
               "actual": float(actual[i]), "predicted": float(predicted[i]), "residual": float(residuals[i])}
              for i in indices]
    bins = min(20, max(5, int(np.ceil(np.sqrt(len(rows))))))
    counts, edges = np.histogram(residuals, bins=bins)
    return {"version": 1, "cohort": cohort, "sample_count": len(rows), "points": points,
            "points_sampled": len(points) < len(rows),
            "residual_mean": float(np.mean(residuals)),
            "residual_histogram": [{"start": float(edges[i]), "end": float(edges[i + 1]), "count": int(count)}
                                   for i, count in enumerate(counts)],
            "provenance": provenance}
