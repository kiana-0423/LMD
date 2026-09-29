import numpy as np
import pytest

from lmd_sidecar.services.training_diagnostics import evaluation_diagnostics, training_provenance


def test_large_evaluations_have_bounded_reproducible_points_and_a_complete_histogram():
    rows = [{"id": str(i)} for i in range(2005)]
    actual = np.arange(len(rows))
    predicted = actual + np.random.default_rng(7).normal(size=len(rows))
    diagnostics = evaluation_diagnostics(np, rows, actual, predicted, "validation", {})
    assert diagnostics == evaluation_diagnostics(np, rows, actual, predicted, "validation", {})
    assert len(diagnostics["points"]) == 1000
    assert diagnostics["points_sampled"] is True
    assert diagnostics["sample_count"] == 2005
    assert sum(bin["count"] for bin in diagnostics["residual_histogram"]) == 2005
    assert diagnostics["residual_mean"] == pytest.approx(np.mean(predicted - actual))


def test_provenance_counts_only_the_rows_actually_used_and_never_assumes_unmarked_is_real():
    rows = [{"provenance": {"is_real": False, "batch_id": "b"}},
            {"provenance": {"data_origin": "synthetic", "batch_id": "a"}},
            {"provenance": {"data_origin": "unmarked"}}]
    assert training_provenance({}, rows) == {
        "synthetic_count": 2, "total_count": 3, "unmarked_count": 1, "batch_ids": ["a", "b"]}
    assert training_provenance({"data_origin": "synthetic", "batch_id": "demo"}, [{}])["synthetic_count"] == 1


def test_invalid_predictions_are_rejected_instead_of_serializing_invalid_plot_points():
    with pytest.raises(ValueError, match="finite"):
        evaluation_diagnostics(np, [{}], [1.0], [np.nan], "validation", {})
    with pytest.raises(ValueError, match="align"):
        evaluation_diagnostics(np, [{}, {}], [1.0], [1.0], "validation", {})
