from __future__ import annotations

import argparse
import importlib
import importlib.metadata
import sys
from typing import Any, Callable

from .services.assessment_service import assess_candidates
from .services.descriptor_service import (
    calculate_descriptors,
    calculate_required_descriptors,
    calculate_required_descriptors_batch,
)
from .services.design_service import generate_candidates, list_templates, validate_structure
from .services.import_service import export_table_rows, preview_table_file
from .services.explanation_service import explain_model
from .services.model_example_service import explain_model_example
from .services.ml_service import describe_model, predict_with_model, train_model
from .services.preparation_service import prepare_molecule
from .services.rdkit_service import (
    calculate_sketcher_descriptors,
    molfile_to_smiles,
    smiles_to_molfile,
    standardize_molecule,
    validate_smiles,
)
from .services.visualization_service import convert_molecule_format, generate_3d_from_smiles, visualize_from_smiles
from .utils.errors import classify_error
from .utils.json_io import make_error, make_success, read_json, write_stdout_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LMD Python sidecar CLI")
    parser.add_argument("command")
    parser.add_argument("--input", required=True, help="Path to JSON input file")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = read_json(args.input)
        handler = command_handlers().get(args.command)
        if handler is None:
            raise ValueError(f"Unsupported command: {args.command}")
        data, warnings = handler(payload)
        write_stdout_json(make_success(data, warnings))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        failure = classify_error(args.command, exc)
        write_stdout_json(make_error(failure.code, failure.detail, failure.params))
        return 1


def command_handlers() -> dict[str, Callable[[dict[str, Any]], tuple[dict[str, Any], list[str]]]]:
    return {
        "health": lambda payload: health_status(),
        "standardize": lambda payload: standardize_molecule(payload["smiles"]),
        "validate-smiles": lambda payload: validate_smiles(payload["smiles"]),
        "molfile-to-smiles": lambda payload: molfile_to_smiles(payload["molfile"]),
        "smiles-to-molfile": lambda payload: smiles_to_molfile(payload["smiles"]),
        "calculate-sketcher-descriptors": lambda payload: calculate_sketcher_descriptors(
            payload["smiles"]
        ),
        "rdkit-descriptors": lambda payload: calculate_descriptors(payload["smiles"], "rdkit"),
        "mordred-descriptors": lambda payload: calculate_descriptors(payload["smiles"], "mordred"),
        "calculate-required-descriptors": lambda payload: calculate_required_descriptors(
            payload["smiles"],
            require_rdkit=payload.get("require_rdkit", True),
            require_mordred=payload.get("require_mordred", True),
        ),
        "calculate-descriptor-batch": lambda payload: calculate_required_descriptors_batch(
            payload.get("items", []),
            require_rdkit=payload.get("require_rdkit", True),
            require_mordred=payload.get("require_mordred", True),
        ),
        # One process for the whole molecule-save sequence; see preparation_service.
        "prepare-molecule": lambda payload: prepare_molecule(
            payload["smiles"],
            include_svg=payload.get("include_svg", True),
            include_molfile=payload.get("include_molfile", True),
            include_3d=payload.get("include_3d", False),
            require_rdkit_descriptors=payload.get("require_rdkit", True),
            require_mordred_descriptors=payload.get("require_mordred", True),
            force_field=payload.get("force_field", "MMFF"),
        ),
        "visualize": lambda payload: visualize_from_smiles(payload["smiles"]),
        "generate-3d": lambda payload: generate_3d_from_smiles(
            payload["smiles"],
            add_hydrogens=payload.get("add_hydrogens", True),
            optimize=payload.get("optimize", True),
            force_field=payload.get("force_field", "MMFF"),
        ),
        "convert-format": lambda payload: convert_molecule_format(
            payload["input_text"], payload["input_format"], payload["output_format"],
            generate_2d=payload.get("generate_2d", False),
        ),
        "import-excel": lambda payload: preview_table_file(payload["file_path"], payload.get("preview_rows", 20)),
        "export-table-rows": lambda payload: export_table_rows(
            payload["file_path"], payload["output_path"], payload.get("chunk_size", 500)
        ),
        "train-model": train_model,
        "explain-model": explain_model,
        "explain-model-example": explain_model_example,
        "predict-with-model": predict_with_model,
        "describe-model": describe_model,
        # Molecular design: template-constrained generation, and prediction with the evidence
        # needed to judge it. Neither writes anything; Rust owns the candidate collection.
        "design-templates": list_templates,
        "design-generate": generate_candidates,
        "design-validate": validate_structure,
        "assess-candidates": assess_candidates,
    }


# Every third-party module a production command imports, with the distribution its version is
# recorded under and the commands that stop working without it.
#
# The list is exhaustive on purpose. Reporting only RDKit and Mordred is what allowed a packaged
# build to answer `health` with "real" while every model command failed on the first import: the
# health check answered a narrower question than the one the caller was asking.
REQUIRED_DEPENDENCIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("rdkit", "rdkit", ("standardize", "validate-smiles", "rdkit-descriptors", "generate-3d", "convert-format", "design-templates", "design-generate", "design-validate", "assess-candidates", "explain-model-example")),
    ("mordred", "mordred", ("mordred-descriptors", "calculate-required-descriptors", "calculate-descriptor-batch")),
    # Mordred builds molecular graphs with networkx, and the sidecar patches one function back
    # onto it; without networkx no Mordred descriptor can be calculated at all.
    ("networkx", "networkx", ("mordred-descriptors", "calculate-required-descriptors", "calculate-descriptor-batch")),
    ("shap", "shap", ("explain-model", "explain-model-example")),
    ("numpy", "numpy", ("train-model", "predict-with-model", "assess-candidates", "explain-model", "explain-model-example")),
    ("pandas", "pandas", ("import-excel", "export-table-rows")),
    ("openpyxl", "openpyxl", ("import-excel",)),
    ("scipy", "scipy", ("train-model", "predict-with-model", "assess-candidates", "explain-model", "explain-model-example")),
    ("sklearn", "scikit-learn", ("train-model", "predict-with-model", "describe-model", "assess-candidates", "explain-model", "explain-model-example")),
    ("joblib", "joblib", ("train-model", "predict-with-model", "describe-model", "assess-candidates", "explain-model", "explain-model-example")),
)


def _probe(module: str, distribution: str) -> dict[str, Any]:
    """Imports a dependency and records what happened.

    An import, not `find_spec`: a package can be present on disk and still fail to load, which is
    exactly the failure a packaged build produces when a compiled dependency was left out. Only
    actually importing it distinguishes "installed" from "usable".
    """
    try:
        importlib.import_module(module)
    except Exception as exc:  # a broken dependency is a reportable state, not a crash
        return {"available": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}
    try:
        version = importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        version = None
    return {"available": True, "version": version}


def health_status() -> tuple[dict[str, Any], list[str]]:
    """Reports every dependency the sidecar's production commands need.

    `mode` is `real` only when all of them import. A build that can calculate descriptors but not
    train a model is not a working sidecar with one feature missing — it is a sidecar that will
    fail at the moment a user asks for the feature, and saying so at startup is the difference
    between a known limitation and a surprise.
    """
    dependencies = {module: _probe(module, distribution) for module, distribution, _ in REQUIRED_DEPENDENCIES}
    missing = [module for module, _, _ in REQUIRED_DEPENDENCIES if not dependencies[module]["available"]]
    unavailable_commands = sorted(
        {command for module, _, commands in REQUIRED_DEPENDENCIES for command in commands if module in missing}
    )
    warnings = []
    if missing:
        warnings.append(
            "Missing sidecar dependencies: "
            + ", ".join(missing)
            + ". Unavailable commands: "
            + ", ".join(unavailable_commands)
            + "."
        )
    return {
        "sidecar_version": "0.1.0",
        "mode": "real" if not missing else "unavailable",
        "dependencies": dependencies,
        "missing": missing,
        "unavailable_commands": unavailable_commands,
        "python_version": sys.version.split()[0],
        # What this bundle was actually built from, recorded at build time rather than guessed at
        # afterwards. A support report that says "scikit-learn 1.7.2" because that is what the
        # reporting machine happens to have is worse than one that says nothing.
        "build_metadata": _build_metadata(),
    }, warnings


def _build_metadata() -> dict[str, Any]:
    """Reads the manifest `scripts/build_sidecar.py` wrote beside this executable.

    Absent in a development checkout, where the sidecar runs from source and there is no bundle to
    describe; that is reported as such rather than as an error.
    """
    import json
    from pathlib import Path

    # `sys._MEIPASS` is where PyInstaller unpacks a one-file bundle, and the manifest is collected
    # into it — so a shipped sidecar can report what it was built from even though Tauri installs
    # the executable on its own, without the files that sat beside it in `dist/`.
    candidates = []
    unpacked = getattr(sys, "_MEIPASS", None)
    if unpacked:
        candidates.append(Path(unpacked) / "build-metadata.json")
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / "build-metadata.json")
    candidates.append(Path(__file__).resolve().parents[2] / "dist" / "build-metadata.json")
    for candidate in candidates:
        try:
            if candidate.is_file():
                return json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as exc:  # a malformed manifest is reportable, not fatal
            return {"error": f"{type(exc).__name__}: {exc}"}
    return {"available": False}


if __name__ == "__main__":
    raise SystemExit(main())
