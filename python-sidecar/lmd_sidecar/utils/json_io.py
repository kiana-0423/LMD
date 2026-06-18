import json
import math
import sys
from pathlib import Path
from typing import Any


def read_json(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as file:
        return json.load(file)


def write_stdout_json(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(sanitize_for_json(obj), ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


def make_success(data: dict[str, Any], warnings: list[str] | None = None) -> dict[str, Any]:
    return {"ok": True, "data": data, "warnings": warnings or []}


def make_error(error: str, warnings: list[str] | None = None) -> dict[str, Any]:
    return {"ok": False, "error": error, "warnings": warnings or []}


def sanitize_for_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): sanitize_for_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [sanitize_for_json(item) for item in value]
    if hasattr(value, "item"):
        return sanitize_for_json(value.item())
    return str(value)
