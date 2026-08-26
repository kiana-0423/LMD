#!/usr/bin/env python3
"""Regenerate the plain-SQL copy of the schema used by the Rust integration tests."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri" / "src" / "db" / "schema.rs"
TARGET = ROOT / "src-tauri" / "src" / "db" / "schema_for_tests.sql"
HEADER = "-- Generated from schema.rs by scripts/sync_test_schema.py. Do not edit by hand.\n"


def main() -> int:
    sql = SOURCE.read_text(encoding="utf-8").split('r#"', 1)[1].rsplit('"#', 1)[0]
    TARGET.write_text(HEADER + sql, encoding="utf-8")
    print(f"Wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
