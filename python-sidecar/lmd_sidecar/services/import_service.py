from __future__ import annotations

from pathlib import Path
from typing import Any


def preview_table_file(file_path: str, preview_rows: int = 20) -> tuple[dict[str, Any], list[str]]:
    path = Path(file_path)
    if not path.exists():
        return {
            "file_path": file_path,
            "sheet_names": [],
            "columns": [],
            "rows": [],
            "mode": "mock",
        }, ["File does not exist in MVP mock preview."]
    try:
        import pandas as pd

        if path.suffix.lower() == ".csv":
            frame = pd.read_csv(path, nrows=preview_rows)
            return {"file_path": file_path, "sheet_names": [], "columns": list(frame.columns), "rows": frame.to_dict("records")}, []
        excel = pd.ExcelFile(path)
        frame = pd.read_excel(path, sheet_name=excel.sheet_names[0], nrows=preview_rows)
        return {"file_path": file_path, "sheet_names": excel.sheet_names, "columns": list(frame.columns), "rows": frame.to_dict("records")}, []
    except Exception as exc:
        return {"file_path": file_path, "sheet_names": [], "columns": [], "rows": [], "mode": "mock"}, [str(exc)]
