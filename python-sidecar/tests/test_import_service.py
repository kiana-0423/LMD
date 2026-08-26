from __future__ import annotations

import csv
import json

import pytest

from lmd_sidecar.services.import_service import export_table_rows, preview_table_file


def write_base_oils_csv(path, count: int) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["id", "name", "base_oil_type", "viscosity_40c"])
        writer.writeheader()
        for index in range(count):
            writer.writerow(
                {
                    "id": f"oil-{index}",
                    "name": f"Base oil {index}",
                    "base_oil_type": "PAO",
                    "viscosity_40c": index,
                }
            )


def test_preview_is_limited_but_export_streams_every_row(tmp_path) -> None:
    source = tmp_path / "base-oils.csv"
    output = tmp_path / "rows.jsonl"
    write_base_oils_csv(source, 25)

    preview, warnings = preview_table_file(str(source), preview_rows=5)
    exported, export_warnings = export_table_rows(str(source), str(output), chunk_size=7)
    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

    assert warnings == []
    assert export_warnings == []
    assert len(preview["preview_rows"]) == 5
    assert preview["preview_count"] == 5
    assert exported["row_count"] == 25
    assert len(rows) == 25
    assert rows[-1]["id"] == "oil-24"


def test_missing_import_file_is_an_error(tmp_path) -> None:
    with pytest.raises(FileNotFoundError, match="does not exist"):
        preview_table_file(str(tmp_path / "missing.csv"))


def test_unsupported_import_extension_is_an_error(tmp_path) -> None:
    source = tmp_path / "data.txt"
    source.write_text("name\nexample\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported import format"):
        preview_table_file(str(source))


def test_non_finite_numbers_do_not_abort_the_export(tmp_path):
    source = tmp_path / "values.csv"
    source.write_text("name,viscosity_40c\nBase A,inf\nBase B,12.5\n", encoding="utf-8")
    destination = tmp_path / "rows.jsonl"

    data, warnings = export_table_rows(str(source), str(destination))

    assert data["row_count"] == 2
    assert warnings == []
    rows = [json.loads(line) for line in destination.read_text(encoding="utf-8").splitlines()]
    assert rows[0]["viscosity_40c"] == "inf"
    assert rows[1]["viscosity_40c"] == 12.5
