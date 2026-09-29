"""Import this reviewed MOL2 batch using LMD's molecule/descriptor storage schema.

The prepared calculations come from LMD's own Python services. The insert fields,
descriptor statuses and default classification match save_molecule_with_required_descriptors.
Source files are also retained as attachments. Re-running does not add duplicates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def import_batch(workspace: Path, manifest: Path, report_file: Path) -> dict:
    workspace = workspace.resolve(strict=True)
    records = json.loads(manifest.read_text())
    assert len(records) == 9
    for record in records:
        source = Path(record["source_path"])
        assert hashlib.sha256(source.read_bytes()).hexdigest() == record["sha256"], source
        prepared = record["prepared"]
        assert prepared["valid"] and prepared["mode"] == "real"
        for key in ("rdkit", "mordred"):
            descriptors = prepared[key]
            assert descriptors["mode"] == "real"
            assert descriptors["descriptor_count"] == len(descriptors["descriptors"]) > 0

    database = workspace / "lmd.sqlite"
    connection = sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    now = datetime.now(timezone.utc)
    timestamp = now.isoformat()
    backup = workspace / "backups" / ("before-mol2-import-" + now.strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite")
    backup.parent.mkdir(parents=True, exist_ok=True)
    assert not backup.exists()
    with sqlite3.connect(backup) as destination:
        connection.backup(destination)
        assert destination.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

    created_files: list[Path] = []
    report = {"workspace": str(workspace), "backup": str(backup), "imported_at": timestamp, "records": []}

    def store_file(relative: str, content: bytes) -> str:
        destination = (workspace / relative).resolve()
        assert destination.is_relative_to(workspace), destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as handle:
            created_files.append(destination)
            handle.write(content)
        return relative

    connection.execute("BEGIN IMMEDIATE")
    try:
        before = connection.execute("SELECT COUNT(*) FROM molecules").fetchone()[0]
        for record in records:
            prepared = record["prepared"]
            matches = connection.execute(
                "SELECT id, name, descriptor_ready FROM molecules WHERE inchi_key = ? OR smiles_canonical = ?",
                (prepared["inchi_key"], prepared["smiles_canonical"]),
            ).fetchall()
            if matches:
                assert len(matches) == 1 and matches[0]["descriptor_ready"] == 1
                report["records"].append({"name": record["name"], "status": "already_present", **dict(matches[0])})
                continue
            assert not connection.execute("SELECT 1 FROM molecules WHERE name = ?", (record["name"],)).fetchone(), record["name"]

            molecule_id = str(uuid.uuid4())
            three_d = prepared["three_d"]
            blocks = {"svg": prepared["svg"], "mol": three_d["mol_block"],
                      "sdf": three_d["sdf_block"], "pdb": three_d["pdb_block"]}
            paths = {extension: store_file(f"files/structures/{molecule_id}.{extension}", content.encode())
                     for extension, content in blocks.items()}
            source = Path(record["source_path"])
            original = source.read_bytes()
            assert hashlib.sha256(original).hexdigest() == record["sha256"]
            attachment_id = str(uuid.uuid4())
            attachment_path = store_file(f"files/attachments/{attachment_id}.mol2", original)
            provenance = "MOL2 import: " + source.name
            conversion = record["conversion"]
            notes = "\n".join([
                f"MOL2 import ({source.name}): inferred aromatic bond IDs: "
                + (", ".join(conversion["inferred_bond_ids"]) or "none")
                + "; atom type changes: " + (", ".join(conversion["normalized_atom_types"]) or "none") + ".",
                "Source SHA-256: " + record["sha256"],
                "3D source: " + record["three_d_source"],
                *record["warnings"],
            ])
            molecule = {
                "id": molecule_id, "name": record["name"], "aliases": "",
                "smiles_raw": prepared["smiles_raw"], "smiles_canonical": prepared["smiles_canonical"],
                "inchi": prepared["inchi"], "inchi_key": prepared["inchi_key"],
                "formula": prepared["formula"], "molecular_weight": prepared["molecular_weight"],
                "category": "candidate", "tags": "[]", "molfile": three_d["mol_block"],
                "duplicate_of": "", "import_mode": "manual_save", "source": provenance,
                "structure_svg_path": paths["svg"], "mol_file_path": paths["mol"],
                "sdf_file_path": paths["sdf"], "pdb_file_path": paths["pdb"],
                "rdkit_descriptor_status": "calculated", "mordred_descriptor_status": "calculated",
                "descriptor_ready": 1, "source_id": provenance, "notes": notes,
                "created_at": timestamp, "updated_at": timestamp,
            }
            connection.execute(
                "INSERT INTO molecules (" + ",".join(molecule) + ") VALUES ("
                + ",".join("?" for _ in molecule) + ")", tuple(molecule.values()))
            for key in ("rdkit", "mordred"):
                descriptors = prepared[key]
                connection.execute(
                    "INSERT INTO molecule_descriptors (id,molecule_id,descriptor_set,descriptor_version,"
                    "descriptors_json,descriptor_count,status,mode,error_message,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), molecule_id, key, descriptors["descriptor_version"],
                     json.dumps(descriptors["descriptors"], allow_nan=False), descriptors["descriptor_count"],
                     "calculated", "real", "", timestamp),
                )
            connection.execute(
                "INSERT INTO attachments (id,linked_entity_type,linked_entity_id,file_name,file_type,relative_path,description,uploaded_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (attachment_id, "molecule", molecule_id, source.name, "mol2", attachment_path,
                 "Original MOL2 source. SHA-256: " + record["sha256"], timestamp),
            )
            report["records"].append({
                "name": record["name"], "id": molecule_id, "status": "imported",
                "formula": prepared["formula"], "smiles": prepared["smiles_canonical"],
                "inferred_bond_ids": conversion["inferred_bond_ids"],
                "normalized_atom_types": conversion["normalized_atom_types"],
                "rdkit_count": prepared["rdkit"]["descriptor_count"],
                "mordred_count": prepared["mordred"]["descriptor_count"],
                "source_sha256": record["sha256"], "original_attachment": attachment_path,
                "three_d_source": record["three_d_source"], "warnings": record["warnings"],
            })
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
        after = connection.execute("SELECT COUNT(*) FROM molecules").fetchone()[0]
        assert after - before == sum(item["status"] == "imported" for item in report["records"])
        report.update({"count_before": before, "count_after": after})
        connection.execute("COMMIT")
    except BaseException:
        connection.execute("ROLLBACK")
        for path in created_files:
            path.unlink(missing_ok=True)
        raise
    finally:
        connection.close()
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    result = import_batch(args.workspace, Path(__file__).with_name("prepared.json"), args.report)
    print(json.dumps({"workspace": result["workspace"], "before": result["count_before"],
                      "after": result["count_after"], "records": [(r["name"], r["status"]) for r in result["records"]]}, ensure_ascii=False))
