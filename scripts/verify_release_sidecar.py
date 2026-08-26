#!/usr/bin/env python3
"""Runs the packaged sidecar through every command a production build depends on.

Why this exists, and why it runs the *binary* rather than the source package: the two are not the
same program. The source tree resolves imports against whatever the build machine happens to have
installed; the PyInstaller executable can only reach what was collected into it. A dependency
dropped from the spec — as scikit-learn and SciPy once were — leaves a sidecar that calculates
descriptors perfectly and fails the moment a user trains a model. `python -m pytest` cannot see
that, because it never runs the executable that ships.

So every check here spawns the real executable, with the real JSON protocol, and fails on:

  * a dependency the health command reports as unavailable;
  * a result that is not `mode: "real"`;
  * output that is not valid JSON, or that reports `ok: false`;
  * a model artifact that was not written;
  * a prediction that does not come back with a finite number for every item.

The model is trained, predicted with, and then described by three separate processes, because
that is the sequence the application performs: nothing about a model may depend on state left
behind in the process that fitted it.

Usage: python scripts/verify_release_sidecar.py [--executable PATH] [--skip-matrix]
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from build_sidecar import TAURI_BINARIES, target_triple


MACH_O_MAGICS = {
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
}

# Every dependency `health` must report as available. The list mirrors REQUIRED_DEPENDENCIES in
# the sidecar; it is repeated rather than imported because this script must be able to check a
# binary built from a different revision of the source.
REQUIRED_DEPENDENCIES = (
    "rdkit",
    "mordred",
    "networkx",
    "numpy",
    "pandas",
    "openpyxl",
    "scipy",
    "sklearn",
    "joblib",
)

# A per-command timeout. Mordred on a first invocation pays the unpacking cost of the whole
# bundle, so these are generous; a hang still fails rather than blocking a CI job forever.
COMMAND_TIMEOUT = 600


class VerificationError(RuntimeError):
    """A check that failed, phrased so the CI log says what to fix."""


def run_command(executable: Path, command: str, payload: dict[str, Any], directory: Path) -> dict[str, Any]:
    """Runs one sidecar command and returns its parsed envelope."""
    input_path = directory / f"{command}-input.json"
    input_path.write_text(json.dumps(payload), encoding="utf-8")
    try:
        result = subprocess.run(
            [str(executable), command, "--input", str(input_path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise VerificationError(f"{command} did not finish within {COMMAND_TIMEOUT}s.") from exc

    if not result.stdout.strip():
        raise VerificationError(
            f"{command} produced no output on stdout (exit {result.returncode}). "
            f"stderr: {result.stderr.strip()[:2000]}"
        )
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise VerificationError(
            f"{command} returned output that is not valid JSON: {result.stdout[:2000]!r}"
        ) from exc
    if envelope.get("ok") is not True:
        raise VerificationError(
            f"{command} failed: {envelope.get('error') or envelope}. "
            f"stderr: {result.stderr.strip()[:2000]}"
        )
    if result.returncode != 0:
        raise VerificationError(f"{command} reported ok but exited {result.returncode}.")
    return envelope


def data_of(envelope: dict[str, Any], command: str, *, require_real: bool = True) -> dict[str, Any]:
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise VerificationError(f"{command} returned no data object.")
    if require_real and data.get("mode") != "real":
        raise VerificationError(
            f"{command} answered with mode {data.get('mode')!r} rather than 'real'. A packaged "
            "build must never fall back to a substitute result."
        )
    return data


# --- fixtures ---------------------------------------------------------------------------------

CSV_TEXT = "name,smiles,concentration\nEthanol,CCO,1.5\nPropanol,CCCO,2.5\nButanol,CCCCO,3.5\n"


def write_minimal_xlsx(path: Path) -> None:
    """Writes a small workbook using only the standard library.

    The point of the XLSX check is that the *bundled* openpyxl can read a workbook. Building the
    fixture with openpyxl would make the check depend on the build machine's copy instead, and
    would quietly pass on a binary that shipped without it.
    """
    rows = [("name", "smiles", "concentration"), ("Ethanol", "CCO", 1.5), ("Propanol", "CCCO", 2.5)]

    def cell(column: int, row: int, value: Any) -> str:
        reference = f"{chr(ord('A') + column)}{row}"
        if isinstance(value, (int, float)):
            return f'<c r="{reference}"><v>{value}</v></c>'
        return f'<c r="{reference}" t="inlineStr"><is><t>{value}</t></is></c>'

    sheet_rows = "".join(
        f'<row r="{index + 1}">'
        + "".join(cell(column, index + 1, value) for column, value in enumerate(row))
        + "</row>"
        for index, row in enumerate(rows)
    )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{sheet_rows}</sheetData></worksheet>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Molecules" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)


def training_dataset() -> dict[str, Any]:
    """A deterministic dataset large enough to hold out a grouped validation split.

    The target is an exact linear function of the features, so a fitted model that cannot predict
    it back is broken rather than merely imprecise. Rows are grouped in pairs, which is what makes
    the run exercise GroupShuffleSplit — the split the application actually uses.
    """
    rows = []
    for index in range(24):
        alpha = float(index)
        beta = float((index * 7) % 11)
        rows.append(
            {
                "id": f"row-{index}",
                "label": f"row-{index}",
                "group_id": f"formulation-{index // 2}",
                "molecule_id": f"molecule-{index}",
                "features": {"rdkit_MolWt": alpha, "rdkit_MolLogP": beta, "concentration": 1.0 + alpha / 10.0},
                "target": 2.0 * alpha + 3.0 * beta + 5.0,
            }
        )
    return {
        "target": "average_friction_coefficient",
        "dataset_mode": "additive_component",
        "interpretation": "one row per additive component",
        "feature_schema_version": "verification",
        "concentration_basis": "wt%",
        "feature_order": ["rdkit_MolWt", "rdkit_MolLogP", "concentration"],
        "rows": rows,
    }


# --- the matrix -------------------------------------------------------------------------------


def check_health(executable: Path, directory: Path) -> None:
    data = data_of(run_command(executable, "health", {}, directory), "health")
    dependencies = data.get("dependencies") or {}
    missing = [name for name in REQUIRED_DEPENDENCIES if not (dependencies.get(name) or {}).get("available")]
    if missing:
        details = "; ".join(
            f"{name}: {(dependencies.get(name) or {}).get('error', 'not reported')}" for name in missing
        )
        raise VerificationError(
            f"The packaged sidecar is missing {len(missing)} required dependency/ies: "
            f"{', '.join(missing)}. {details}. Add them to python-sidecar/lmd-sidecar.spec."
        )
    reported = data.get("missing")
    if reported:
        raise VerificationError(f"health reports missing dependencies: {reported}")
    print("  health: " + ", ".join(f"{name} {dependencies[name].get('version') or '?'}" for name in REQUIRED_DEPENDENCIES))


def check_descriptors(executable: Path, directory: Path) -> None:
    rdkit = data_of(run_command(executable, "rdkit-descriptors", {"smiles": "CCO"}, directory), "rdkit-descriptors")
    if not rdkit.get("descriptors"):
        raise VerificationError("rdkit-descriptors returned no descriptors.")
    mordred = data_of(
        run_command(executable, "mordred-descriptors", {"smiles": "CCO"}, directory), "mordred-descriptors"
    )
    if not mordred.get("descriptors"):
        raise VerificationError("mordred-descriptors returned no descriptors.")
    print(f"  descriptors: rdkit {len(rdkit['descriptors'])}, mordred {len(mordred['descriptors'])}")

    strict = data_of(
        run_command(
            executable,
            "calculate-required-descriptors",
            {"smiles": "CCO", "require_rdkit": True, "require_mordred": True},
            directory,
        ),
        "calculate-required-descriptors",
    )
    for engine in ("rdkit", "mordred"):
        if (strict.get(engine) or {}).get("mode") != "real":
            raise VerificationError(
                f"calculate-required-descriptors did not use the bundled {engine}: {strict.get(engine)}"
            )


def check_descriptor_batch(executable: Path, directory: Path) -> None:
    items = [
        {"molecule_id": "m-1", "smiles": "CCO"},
        {"molecule_id": "m-2", "smiles": "CCCO"},
        {"molecule_id": "m-3", "smiles": "c1ccccc1O"},
    ]
    envelope = run_command(executable, "calculate-descriptor-batch", {"items": items}, directory)
    data = data_of(envelope, "calculate-descriptor-batch", require_real=False)
    if data.get("success_count") != len(items) or data.get("failed_count") != 0:
        raise VerificationError(f"calculate-descriptor-batch did not calculate every molecule: {data}")
    print(f"  batch descriptors: {data['success_count']}/{len(items)}")


def check_structures(executable: Path, directory: Path) -> None:
    generated = data_of(
        run_command(
            executable,
            "generate-3d",
            {"smiles": "CCO", "add_hydrogens": True, "optimize": True, "force_field": "MMFF"},
            directory,
        ),
        "generate-3d",
    )
    block = generated.get("mol_block") or generated.get("sdf_block") or ""
    if "V2000" not in block and "V3000" not in block:
        raise VerificationError(f"generate-3d returned no molfile coordinates: {sorted(generated)}")

    converted = data_of(
        run_command(
            executable,
            "convert-format",
            {"input_text": "CCO", "input_format": "smiles", "output_format": "inchikey"},
            directory,
        ),
        "convert-format",
    )
    # `content` is the field `convert_molecule_format` actually returns, and the field the Rust
    # caller reads (`export_molecule_file` pulls `/data/content`). The two older names are kept as
    # fallbacks so this check still works against a sidecar built from an earlier revision.
    key = str(converted.get("content") or converted.get("output_text") or converted.get("output") or "")
    if len(key) != 27 or key.count("-") != 2:
        raise VerificationError(f"convert-format did not produce an InChIKey: {converted}")
    print(f"  structures: 3D generated, InChIKey {key}")


def check_composite_preparation(executable: Path, directory: Path) -> None:
    """The one command a molecule save now runs, verified end to end.

    Every part of it is checked, because the whole point of the command is that no other process
    fills in what it misses: if the SVG is empty or Mordred is absent, the save it backs has no
    second chance to notice.
    """
    started = time.perf_counter()
    prepared = data_of(
        run_command(
            executable,
            "prepare-molecule",
            {
                "smiles": "CCO",
                "include_svg": True,
                "include_molfile": True,
                "include_3d": True,
                "require_rdkit": True,
                "require_mordred": True,
            },
            directory,
        ),
        "prepare-molecule",
    )
    elapsed = time.perf_counter() - started

    for field in ("smiles_canonical", "inchi", "inchi_key", "formula", "molecular_weight"):
        if not prepared.get(field):
            raise VerificationError(f"prepare-molecule returned no {field}: {sorted(prepared)}")
    svg = str(prepared.get("svg") or "")
    if "<svg" not in svg:
        raise VerificationError("prepare-molecule returned no SVG drawing.")
    molfile = str(prepared.get("molfile") or "")
    if "V2000" not in molfile and "V3000" not in molfile:
        raise VerificationError("prepare-molecule returned no connection table.")
    three_d = prepared.get("three_d") or {}
    if not str(three_d.get("mol_block") or ""):
        raise VerificationError("prepare-molecule returned no 3D structure.")
    rdkit_descriptors = (prepared.get("rdkit") or {}).get("descriptors") or {}
    mordred_descriptors = (prepared.get("mordred") or {}).get("descriptors") or {}
    if not rdkit_descriptors:
        raise VerificationError("prepare-molecule returned no RDKit descriptors.")
    if len(mordred_descriptors) < 100:
        raise VerificationError(
            f"prepare-molecule returned only {len(mordred_descriptors)} Mordred descriptors."
        )
    if (prepared.get("rdkit") or {}).get("mode") != "real":
        raise VerificationError("prepare-molecule reported a non-real descriptor mode.")

    print(
        f"  prepare-molecule: 1 process, {elapsed:.1f}s, "
        f"{len(rdkit_descriptors)} RDKit + {len(mordred_descriptors)} Mordred descriptors"
    )


def check_preparation_replaces_the_sequence(executable: Path, directory: Path) -> None:
    """The composite result has to match what the individual commands produce.

    A faster path that returns different chemistry is not an optimization, so this runs the four
    commands `prepare-molecule` replaces and compares the identifiers. It also reports both
    timings, which is the measurement the change was made for.
    """
    smiles = "CC(=O)Oc1ccccc1C(=O)O"

    sequence_started = time.perf_counter()
    standardized = data_of(
        run_command(executable, "standardize", {"smiles": smiles}, directory), "standardize"
    )
    visualized = data_of(
        run_command(executable, "visualize", {"smiles": smiles}, directory), "visualize"
    )
    # `smiles-to-molfile` reports `valid` rather than `mode`: it converts a structure and has no
    # substitute to fall back to, so there is no "real vs mock" distinction for it to declare.
    # Demanding one here would fail a command that is working correctly.
    data_of(
        run_command(executable, "smiles-to-molfile", {"smiles": smiles}, directory),
        "smiles-to-molfile",
        require_real=False,
    )
    data_of(
        run_command(
            executable,
            "calculate-required-descriptors",
            {"smiles": smiles, "require_rdkit": True, "require_mordred": True},
            directory,
        ),
        "calculate-required-descriptors",
    )
    sequence_elapsed = time.perf_counter() - sequence_started

    composite_started = time.perf_counter()
    prepared = data_of(
        run_command(
            executable,
            "prepare-molecule",
            {"smiles": smiles, "include_svg": True, "include_molfile": True, "include_3d": False},
            directory,
        ),
        "prepare-molecule",
    )
    composite_elapsed = time.perf_counter() - composite_started

    for field in ("smiles_canonical", "inchi", "inchi_key", "formula"):
        if prepared.get(field) != standardized.get(field):
            raise VerificationError(
                f"prepare-molecule disagrees with standardize on {field}: "
                f"{prepared.get(field)!r} vs {standardized.get(field)!r}"
            )
    if ("<svg" in str(visualized.get("svg", ""))) != ("<svg" in str(prepared.get("svg", ""))):
        raise VerificationError("prepare-molecule and visualize disagree about the drawing.")

    print(
        f"  molecule preparation: 4 processes in {sequence_elapsed:.1f}s -> "
        f"1 process in {composite_elapsed:.1f}s"
    )


def check_tables(executable: Path, directory: Path) -> None:
    csv_path = directory / "molecules.csv"
    csv_path.write_text(CSV_TEXT, encoding="utf-8")
    xlsx_path = directory / "molecules.xlsx"
    write_minimal_xlsx(xlsx_path)

    csv_preview = data_of(
        run_command(executable, "import-excel", {"file_path": str(csv_path), "preview_rows": 10}, directory),
        "import-excel(csv)",
    )
    if csv_preview.get("preview_count") != 3:
        raise VerificationError(f"CSV preview returned {csv_preview.get('preview_count')} rows, expected 3.")

    xlsx_preview = data_of(
        run_command(executable, "import-excel", {"file_path": str(xlsx_path), "preview_rows": 10}, directory),
        "import-excel(xlsx)",
    )
    if xlsx_preview.get("preview_count") != 2:
        raise VerificationError(f"XLSX preview returned {xlsx_preview.get('preview_count')} rows, expected 2.")
    if not xlsx_preview.get("sheet_names"):
        raise VerificationError("XLSX preview reported no worksheets; openpyxl is not usable.")

    csv_out = directory / "rows-from-csv.jsonl"
    exported = data_of(
        run_command(
            executable,
            "export-table-rows",
            {"file_path": str(csv_path), "output_path": str(csv_out), "chunk_size": 2},
            directory,
        ),
        "export-table-rows(csv)",
    )
    if exported.get("row_count") != 3 or len(csv_out.read_text(encoding="utf-8").strip().splitlines()) != 3:
        raise VerificationError(f"CSV export wrote {exported.get('row_count')} rows, expected 3.")

    xlsx_out = directory / "rows-from-xlsx.jsonl"
    exported_xlsx = data_of(
        run_command(
            executable,
            "export-table-rows",
            {"file_path": str(xlsx_path), "output_path": str(xlsx_out), "chunk_size": 2},
            directory,
        ),
        "export-table-rows(xlsx)",
    )
    if exported_xlsx.get("row_count") != 2:
        raise VerificationError(
            f"XLSX export wrote {exported_xlsx.get('row_count')} rows, expected 2. openpyxl reads this path."
        )
    print("  tables: CSV preview/export and XLSX preview/export via openpyxl")


def check_model_lifecycle(executable: Path, directory: Path) -> None:
    dataset_path = directory / "dataset.json"
    dataset = training_dataset()
    dataset_path.write_text(json.dumps(dataset), encoding="utf-8")
    model_path = directory / "verification-model.joblib"

    trained = data_of(
        run_command(
            executable,
            "train-model",
            {
                "dataset_path": str(dataset_path),
                "model_path": str(model_path),
                "algorithm": "ridge",
                "min_samples": 12,
            },
            directory,
        ),
        "train-model",
    )
    if not model_path.is_file() or model_path.stat().st_size == 0:
        raise VerificationError(f"train-model reported success but wrote no model artifact at {model_path}.")
    if trained.get("sample_count") != len(dataset["rows"]):
        raise VerificationError(f"train-model used {trained.get('sample_count')} of {len(dataset['rows'])} rows.")
    print(f"  train-model: {trained['algorithm']}, {trained['sample_count']} rows, sklearn {trained.get('sklearn_version')}")

    # A second process, loading the artifact from disk: nothing may carry over from the fit.
    predicted = data_of(
        run_command(
            executable,
            "predict-with-model",
            {
                "model_path": str(model_path),
                "feature_schema_version": dataset["feature_schema_version"],
                "items": [
                    {"id": "check-1", "label": "check-1", "features": {"rdkit_MolWt": 1.0, "rdkit_MolLogP": 7.0, "concentration": 1.1}},
                    {"id": "check-2", "label": "check-2", "features": {"rdkit_MolWt": 4.0, "rdkit_MolLogP": 6.0, "concentration": 1.4}},
                ],
            },
            directory,
        ),
        "predict-with-model",
    )
    predictions = predicted.get("predictions") or []
    if len(predictions) != 2:
        raise VerificationError(f"predict-with-model returned {len(predictions)} predictions, expected 2.")
    for prediction in predictions:
        value = prediction.get("value")
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise VerificationError(f"predict-with-model returned a non-numeric value: {prediction}")
    print(f"  predict-with-model: {[round(float(item['value']), 4) for item in predictions]}")

    # A third process, reading the same artifact: this is the path the model registry uses.
    described = data_of(
        run_command(executable, "describe-model", {"model_path": str(model_path)}, directory), "describe-model"
    )
    if described.get("feature_order") != dataset["feature_order"]:
        raise VerificationError(
            f"describe-model reported feature order {described.get('feature_order')}, "
            f"expected {dataset['feature_order']}."
        )
    if described.get("concentration_basis") != dataset["concentration_basis"]:
        raise VerificationError(
            f"describe-model lost the concentration basis: {described.get('concentration_basis')!r}"
        )
    print(f"  describe-model: reloaded in a separate process, {len(described['feature_order'])} features")


CHECKS = (
    ("dependency health", check_health),
    ("RDKit and Mordred descriptors", check_descriptors),
    ("batch descriptors", check_descriptor_batch),
    ("3D generation and format conversion", check_structures),
    ("composite molecule preparation", check_composite_preparation),
    ("composite preparation matches the sequence it replaces", check_preparation_replaces_the_sequence),
    ("CSV and XLSX import/export", check_tables),
    ("model train, predict, describe", check_model_lifecycle),
)


def run_matrix(executable: Path) -> None:
    """Runs every check against one executable, raising on the first failure."""
    with tempfile.TemporaryDirectory(prefix="lmd-sidecar-verify-") as temporary:
        directory = Path(temporary)
        for label, check in CHECKS:
            print(f"Checking {label}...")
            check(executable, directory)
    print("All packaged sidecar commands verified.")


def native_executable(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    suffix = ".exe" if platform.system() == "Windows" else ""
    return TAURI_BINARIES / f"lmd-sidecar-{target_triple()}{suffix}"


def check_native(executable: Path) -> None:
    if not executable.is_file():
        raise VerificationError(
            f"Release sidecar {executable} is missing. Run `python scripts/build_sidecar.py` "
            "before `tauri build`."
        )
    header = executable.read_bytes()[:4]
    native = (
        (platform.system() == "Darwin" and header in MACH_O_MAGICS)
        or (platform.system() == "Windows" and header[:2] == b"MZ")
        or (platform.system() == "Linux" and header == b"\x7fELF")
    )
    if not native:
        raise VerificationError(
            f"Release sidecar {executable} is not a native executable; a development script "
            "cannot be bundled. Run `python scripts/build_sidecar.py`."
        )
    print(f"Verified native release sidecar: {executable}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", help="Verify this executable instead of the installed release sidecar.")
    parser.add_argument(
        "--skip-matrix",
        action="store_true",
        help="Only check that a native executable is installed, without running its commands.",
    )
    args = parser.parse_args(argv[1:])
    try:
        executable = native_executable(args.executable)
        check_native(executable)
        if not args.skip_matrix:
            run_matrix(executable)
        return 0
    except VerificationError as exc:
        print(f"Sidecar verification failed: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"Sidecar verification could not run: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
