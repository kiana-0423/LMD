"""Exercise repeat import, rollback, exact cleanup and dependency protection on copies only."""
import copy
import json
import sqlite3
import tempfile
from pathlib import Path

import batch

manifest = batch.load_manifest(batch.HERE / "manifest.json")
populated = Path("/tmp/lmd-generated-demo-staging/lmd.sqlite")
report = {}
with tempfile.TemporaryDirectory(prefix="lmd-synthetic-safety-") as temporary:
    database = Path(temporary) / "lmd.sqlite"
    with batch.connect(populated) as source, sqlite3.connect(database) as dest:
        source.backup(dest)
        dest.execute("PRAGMA journal_mode = DELETE").fetchone()
    with batch.connect(database) as connection:
        original = batch.snapshot(connection, batch.identifiers(manifest))
        populated_snapshot = batch.snapshot(connection)
    assert batch.apply(database, manifest)["status"] == "already_present"
    report["repeat_import_does_not_duplicate"] = True
    assert batch.cleanup(database, manifest)["status"] == "preview_only"
    with batch.connect(database) as connection:
        assert batch.snapshot(connection) == populated_snapshot
    report["cleanup_defaults_to_preview"] = True
    batch.cleanup(database, manifest, execute=True)
    with batch.connect(database) as connection:
        assert batch.snapshot(connection) == original
    report["cleanup_restores_original_records_exactly"] = True

    invalid = copy.deepcopy(manifest)
    invalid["rows"]["formulation_components"][0]["base_oil_id"] = "nonexistent-for-rollback-check"
    try:
        batch.apply(database, invalid)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Broken foreign key should fail the complete transaction")
    with batch.connect(database) as connection:
        assert batch.snapshot(connection) == original
    report["failed_import_rolls_back_all_inserts"] = True

    batch.apply(database, manifest)
    with batch.connect(database, write=True) as connection:
        connection.execute("INSERT INTO experiments(id,formulation_id,created_at,updated_at) VALUES ('later-user-experiment',?,'now','now')",
                           (manifest["rows"]["formulations"][0]["id"],))
    try:
        batch.cleanup(database, manifest, execute=True)
    except AssertionError as error:
        assert "Additional dependent" in str(error)
    else:
        raise AssertionError("Later unmarked experiments must stop cleanup")
    report["cleanup_refuses_later_unmarked_dependents"] = True

(batch.HERE / "safety-checks.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
