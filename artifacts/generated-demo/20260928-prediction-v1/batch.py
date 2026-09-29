"""Explicit, reversible synthetic demonstration data. Never called by the application.

All numeric response rules below are arbitrary software fixtures, NOT physical models.
The manifest pins exact records; apply is transactional and repeatable, cleanup defaults
to a preview and refuses modified records or new dependents.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BATCH = "SYNTH-DEMO-20260928-01"
SEED = 20260928
LABEL = "生成演示·非真实"
NOTICE = "生成数据，非真实实验；仅用于软件测试与预测功能展示，不代表材料实测性能或配方可行性。"
SOURCE_TABLES = ("molecules", "molecule_descriptors", "base_oils", "additives", "commercial_products")
WRITE_TABLES = ("formulations", "formulation_components", "experiments", "performance_results", "data_sources")
HERE = Path(__file__).resolve().parent


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def connect(path, write=False):
    path = Path(path).resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + ("?mode=rw" if write else "?mode=ro"),
                                 uri=True, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def records(connection, table):
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY id')]


def health(connection):
    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()


def snapshot(connection, excluded=None):
    excluded = excluded or {}
    tables = [r[0] for r in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    result = {}
    for table in tables:
        rows = [dict(r) for r in connection.execute(f'SELECT * FROM "{table}"')]
        rows = [r for r in rows if r.get("id") not in excluded.get(table, set())]
        result[table] = digest(sorted(encode(row) for row in rows))
    return result


def marker(extra=None):
    return {"batch_id": BATCH, "data_origin": "synthetic", "is_real": False,
            "purpose": "prediction_demo_and_software_testing", "seed": SEED,
            "generator_version": "1", "notice": NOTICE, **(extra or {})}


def prepare(database, manifest_path):
    rng = random.Random(SEED)
    with connect(database) as connection:
        health(connection)
        oils = records(connection, "base_oils")
        additives = records(connection, "additives")
        molecules = {r["id"]: r for r in records(connection, "molecules")}
        descriptors = {}
        for row in connection.execute("SELECT * FROM molecule_descriptors WHERE descriptor_set='rdkit' AND status='calculated' AND mode='real' ORDER BY calculated_at"):
            descriptors[row["molecule_id"]] = json.loads(row["descriptors_json"])
        assert len(oils) == 17 and len(additives) == 21, "Review library changes before preparing this batch."
        assert all(a["molecule_id"] in descriptors and not a["commercial_product_id"] for a in additives)
        source_hashes = {table: digest(records(connection, table)) for table in SOURCE_TABLES}
        original_models = [r["id"] for r in records(connection, "models")]
    timestamp = datetime.now(timezone.utc).isoformat()
    notes = f"[{LABEL}] {NOTICE}\n" + encode(marker())
    rows = {table: [] for table in WRITE_TABLES}

    # Four randomized concentration levels for each molecule support single-additive models.
    scenarios = [([a], [round(level * rng.uniform(0.85, 1.15), 4)])
                 for a in additives for level in (0.25, 0.75, 1.5, 3.0)]
    # Seven disjoint random molecule groups keep group-held-out validation possible.
    # Blending across every molecule would connect all rows into one leakage group.
    grouped = additives[:]
    rng.shuffle(grouped)
    groups = [grouped[index:index + 3] for index in range(0, len(grouped), 3)]
    # Balanced two/three-additive blends exercise aggregation and mixture prediction.
    for index in range(42):
        selected = rng.sample(groups[index % len(groups)], 2 + index % 2)
        scenarios.append((selected, [round(rng.uniform(0.15, 1.8), 4) for _ in selected]))
    rng.shuffle(scenarios)
    oil_order = (oils * math.ceil(len(scenarios) / len(oils)))[:len(scenarios)]
    rng.shuffle(oil_order)

    for index, ((selected, concentrations), oil) in enumerate(zip(scenarios, oil_order), 1):
        fid = f"{BATCH}-F{index:03d}"
        total = round(sum(concentrations), 4)
        names = [molecules[a["molecule_id"]]["name"] for a in selected]
        rows["formulations"].append({
            "id": fid, "name": f"[{LABEL}] D{index:03d} | {oil['name']} + {' / '.join(names)}",
            "preparation_method": "生成配方，未实际制备", "stability_observation": "未实际制备或观察（生成数据）",
            "notes": notes, "created_at": timestamp, "updated_at": timestamp,
        })
        for component_index, (role, entity_id, concentration) in enumerate(
                [("base_oil", oil["id"], round(100 - total, 4))]
                + [("additive", a["id"], c) for a, c in zip(selected, concentrations)]):
            rows["formulation_components"].append({
                "id": f"{fid}-C{component_index}", "formulation_id": fid, "component_role": role,
                "base_oil_id": entity_id if role == "base_oil" else None,
                "additive_id": entity_id if role == "additive" else None, "molecule_id": None,
                "concentration_value": concentration, "concentration_unit": "wt%",
                "concentration_standard_value": concentration, "concentration_standard_unit": "wt%", "notes": notes,
            })

        def weighted(key):
            return sum(c * float(descriptors[a["molecule_id"]][key]) for a, c in zip(selected, concentrations)) / total

        # Arbitrary smooth response surfaces plus seeded noise create learnable demo signals.
        # Coefficients and concentrations are invented; no solubility/compatibility is claimed.
        polarity = weighted("TPSA") / (weighted("TPSA") + 80)
        size = weighted("MolWt") / (weighted("MolWt") + 350)
        aromatic = weighted("NumAromaticRings") / (weighted("NumAromaticRings") + 2)
        hetero = weighted("NumHeteroatoms") / (weighted("NumHeteroatoms") + 3)
        dose = 1 - math.exp(-total / 1.5)
        v40, v100 = float(oil["viscosity_40c"]), float(oil["viscosity_100c"])
        friction = 0.14 - 0.045 * dose - 0.018 * polarity + 0.002 * math.log1p(v100)
        pb = 550 + 400 * dose + 200 * hetero
        pd = 1500 + 1300 * dose + 450 * hetero

        def noise(value, fraction=0.018, digits=6):
            return round(value * (1 + rng.gauss(0, fraction)), digits)

        responses = [
            ("TE77", 100.0, {"average_friction_coefficient": noise(friction),
                            "stable_friction_coefficient": noise(friction * 0.94),
                            "wear_scar_width_value": noise(650 - 200 * dose - 100 * polarity)}),
            ("four-ball", 75.0, {"wear_scar_diameter_value": noise(700 - 220 * dose - 110 * hetero),
                                "extreme_pressure_value": noise(1100 + 850 * dose + 350 * hetero),
                                "pb_value": noise(pb), "pd_value": noise(pd)}),
            ("PDSC", None, {"initial_oxidation_temperature_value": noise(170 + 55 * dose + 40 * aromatic, 0.01)}),
            ("TGA", None, {"initial_decomposition_temperature_value": noise(250 + 65 * size + 30 * dose, 0.01)}),
            ("kinematic-viscosity", 40.0, {"viscosity_40c": noise(v40 * (1 + 0.012 * total * (1 + size)), 0.005)}),
            ("kinematic-viscosity", 100.0, {"viscosity_100c": noise(v100 * (1 + 0.009 * total * (1 + size)), 0.005)}),
        ]
        for experiment_index, (test_type, temperature, values) in enumerate(responses, 1):
            eid = f"{fid}-E{experiment_index}"
            parameters = {"ambientTemperatureC": 23.0, "humidityPercent": 50.0,
                          "environmentProvenance": {key: {"source": "generated", "batchId": BATCH}
                              for key in ("ambientTemperatureC", "humidityPercent")}}
            if test_type == "TE77":
                parameters.update(mode="reciprocating", strokeMm=10.0, frequencyHz=10.0)
            if test_type == "four-ball":
                parameters.update(speedRpm=1200.0)
            tribology = test_type in ("TE77", "four-ball")
            rows["experiments"].append({
                "id": eid, "formulation_id": fid, "test_type": test_type,
                "test_standard": "SYNTHETIC-DEMO（非标准实测）", "instrument": f"生成演示（非真实）-{test_type}",
                "upper_material": "虚拟钢试样" if tribology else None,
                "lower_material": "虚拟钢试样" if tribology else None,
                "load_value": (100.0 if test_type == "TE77" else 392.0) if tribology else None,
                "load_unit": "N" if tribology else None, "temperature_value": temperature,
                "temperature_unit": "C" if temperature is not None else None,
                "duration_value": 60.0 if tribology else None, "duration_unit": "min" if tribology else None,
                "stroke_value": parameters.get("strokeMm"), "stroke_unit": "mm" if test_type == "TE77" else None,
                "frequency_value": parameters.get("frequencyHz"), "frequency_unit": "Hz" if test_type == "TE77" else None,
                "speed_value": parameters.get("speedRpm"), "speed_unit": "rpm" if test_type == "four-ball" else None,
                "humidity": 50.0, "test_parameters_json": encode(parameters),
                "operator": "SYNTHETIC_GENERATOR（非实验人员）", "experiment_date": timestamp[:10],
                "notes": notes, "created_at": timestamp, "updated_at": timestamp,
            })
            rows["performance_results"].append({
                "id": f"{eid}-R", "experiment_id": eid, **values,
                "wear_scar_width_unit": "um" if "wear_scar_width_value" in values else None,
                "wear_scar_diameter_unit": "um" if "wear_scar_diameter_value" in values else None,
                "initial_oxidation_temperature_unit": "C" if test_type == "PDSC" else None,
                "extreme_pressure_unit": "N" if test_type == "four-ball" else None,
                "repeat_count": None, "std_json": "{}",
                "raw_result_json": encode(marker({"formulation_id": fid, "test_type": test_type,
                    "generation_rule": "batch.py: weighted descriptors + dose response + seeded Gaussian noise",
                    "generated_values": values})),
                "notes": notes, "created_at": timestamp, "updated_at": timestamp,
            })
    counts = {table: len(items) for table, items in rows.items()}
    counts["data_sources"] = 1
    rows["data_sources"].append({
        "id": BATCH, "source_type": "synthetic_demo", "title": f"[{LABEL}] 预测功能演示 {BATCH}",
        "authors": "LMD synthetic demonstration generator", "year": int(timestamp[:4]),
        "notes": encode(marker({"counts": counts, "created_at": timestamp,
                                "cleanup_manifest": str(manifest_path.resolve())})),
        "created_at": timestamp, "updated_at": timestamp,
    })
    manifest = {**marker(), "created_at": timestamp, "source_hashes": source_hashes,
                "original_model_ids": original_models, "counts": counts, "rows": rows,
                "source_base_oils": [{"id": o["id"], "name": o["name"]} for o in oils],
                "source_additives": [{"id": a["id"], "molecule_id": a["molecule_id"],
                                      "name": molecules[a["molecule_id"]]["name"]} for a in additives]}
    with manifest_path.open("x") as handle:
        handle.write(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False))
    return {"manifest": str(manifest_path), "batch_id": BATCH, "counts": counts}


def load_manifest(path):
    manifest = json.loads(path.read_text())
    assert manifest["batch_id"] == BATCH and manifest["data_origin"] == "synthetic" and manifest["is_real"] is False
    assert set(manifest["rows"]) == set(WRITE_TABLES)
    for table, rows in manifest["rows"].items():
        assert len(rows) == manifest["counts"][table]
        assert all(row["id"].startswith(BATCH) and BATCH in row["notes"] for row in rows)
    return manifest


def identifiers(manifest):
    return {table: {row["id"] for row in rows} for table, rows in manifest["rows"].items()}


def verify(connection, manifest):
    health(connection)
    for table, rows in manifest["rows"].items():
        for expected in rows:
            stored = connection.execute(f'SELECT * FROM "{table}" WHERE id=?', (expected["id"],)).fetchone()
            assert stored is not None, f"Missing {table}: {expected['id']}"
            assert all(stored[key] == value for key, value in expected.items()), f"Changed {table}: {expected['id']}"
            assert all(stored[key] is None for key in stored.keys() if key not in expected), \
                f"Additional fields were entered in {table}: {expected['id']}"
    for fid in identifiers(manifest)["formulations"]:
        total = connection.execute("SELECT SUM(concentration_value) FROM formulation_components WHERE formulation_id=?", (fid,)).fetchone()[0]
        assert math.isclose(total, 100.0, abs_tol=1e-8)
    return {"batch_id": BATCH, "counts": manifest["counts"], "integrity": "ok",
            "all_records_marked_synthetic": True, "all_formulation_totals_wt_percent": 100}


def backup(connection, database, action):
    dest = database.parent / "backups" / f"before-{action}-{BATCH}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.sqlite"
    dest.parent.mkdir(parents=True, exist_ok=True)
    assert not dest.exists()
    with sqlite3.connect(dest) as copied:
        connection.backup(copied)
        health(copied)
    return dest


def apply(database, manifest):
    with connect(database, write=True) as connection:
        if connection.execute("SELECT 1 FROM data_sources WHERE id=?", (BATCH,)).fetchone():
            return {**verify(connection, manifest), "status": "already_present"}
        saved = backup(connection, database, "generated-demo")
        connection.execute("BEGIN IMMEDIATE")
        try:
            for table, expected in manifest["source_hashes"].items():
                assert digest(records(connection, table)) == expected, f"Source library changed: {table}"
            before = snapshot(connection)
            for table, rows in manifest["rows"].items():
                for row in rows:
                    connection.execute(f'INSERT INTO "{table}" ({",".join(row)}) VALUES ({",".join("?" for _ in row)})', tuple(row.values()))
            report = verify(connection, manifest)
            assert snapshot(connection, identifiers(manifest)) == before, "Existing records changed"
            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise
    return {**report, "status": "inserted", "database": str(database), "backup": str(saved),
            "original_records_unchanged": True, "manifest_sha256": digest(manifest)}


def check_dependents(connection, manifest):
    ids = identifiers(manifest)
    # Later real records, attachments and models must be reviewed, never swept up in cleanup.
    for table, parent_key, parents in (("experiments", "formulation_id", ids["formulations"]),
                ("formulation_components", "formulation_id", ids["formulations"]),
                ("performance_results", "experiment_id", ids["experiments"])):
        extras = [r["id"] for r in records(connection, table) if r[parent_key] in parents and r["id"] not in ids[table]]
        assert not extras, f"Additional dependent records need review: {extras}"
    assert not [r["id"] for r in records(connection, "attachments")
                if r["linked_entity_id"] in set().union(*ids.values())], "Review attached files before cleanup."
    assert not [r["id"] for r in records(connection, "models") if r["id"] not in manifest["original_model_ids"]], \
        "Models have been trained since generation. Remove/review models using synthetic data before cleanup."


def cleanup(database, manifest, execute=False):
    with connect(database, write=execute) as connection:
        verify(connection, manifest)
        check_dependents(connection, manifest)
        ids = identifiers(manifest)
        if not execute:
            return {"status": "preview_only", "batch_id": BATCH, "would_delete": manifest["counts"]}
        saved = backup(connection, database, "remove-generated-demo")
        connection.execute("BEGIN IMMEDIATE")
        try:
            verify(connection, manifest)
            check_dependents(connection, manifest)
            before = snapshot(connection, ids)
            for table in ("performance_results", "experiments", "formulation_components", "formulations", "data_sources"):
                connection.executemany(f'DELETE FROM "{table}" WHERE id=?', [(key,) for key in ids[table]])
            health(connection)
            assert snapshot(connection) == before, "Unrelated records changed"
            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise
    return {"status": "removed", "batch_id": BATCH, "deleted": manifest["counts"], "backup": str(saved)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "apply", "verify", "cleanup"))
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--execute-cleanup", action="store_true", help="Cleanup otherwise only previews; use only when deletion is requested.")
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare(args.database, args.manifest)
    else:
        manifest = load_manifest(args.manifest)
        if args.command == "apply":
            result = apply(args.database, manifest)
        elif args.command == "cleanup":
            result = cleanup(args.database, manifest, args.execute_cleanup)
        else:
            with connect(args.database) as conn:
                result = verify(conn, manifest)
    if args.report:
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(encode(result))
