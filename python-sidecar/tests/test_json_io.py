from lmd_sidecar.utils.json_io import make_error, make_success, sanitize_for_json


def test_make_success_uses_empty_warnings_by_default():
    result = make_success({"value": 1})
    assert result == {"ok": True, "data": {"value": 1}, "warnings": []}


def test_make_success_preserves_warnings():
    result = make_success({"value": 1}, ["mock warning"])
    assert result["warnings"] == ["mock warning"]


def test_make_error_uses_error_key():
    result = make_error("failed")
    assert result == {"ok": False, "error": "failed", "warnings": []}


def test_sanitize_for_json_replaces_non_finite_float():
    assert sanitize_for_json(float("nan")) is None
