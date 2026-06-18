from __future__ import annotations

import argparse
import sys
from typing import Any, Callable

from .services.descriptor_service import calculate_descriptors, calculate_required_descriptors
from .services.import_service import preview_table_file
from .services.ml_service import optimize_formulation_mock, predict_additive_screening
from .services.rdkit_service import (
    calculate_sketcher_descriptors,
    molfile_to_smiles,
    smiles_to_molfile,
    standardize_molecule,
    validate_smiles,
)
from .services.visualization_service import convert_molecule_format, generate_3d_from_smiles, visualize_from_smiles
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
        write_stdout_json(make_error(str(exc)))
        return 1


def command_handlers() -> dict[str, Callable[[dict[str, Any]], tuple[dict[str, Any], list[str]]]]:
    return {
        "standardize": lambda payload: standardize_molecule(payload["smiles"]),
        "validate-smiles": lambda payload: validate_smiles(payload["smiles"]),
        "molfile-to-smiles": lambda payload: molfile_to_smiles(payload["molfile"]),
        "smiles-to-molfile": lambda payload: smiles_to_molfile(payload["smiles"]),
        "calculate-sketcher-descriptors": lambda payload: calculate_sketcher_descriptors(
            payload["smiles"], payload.get("allow_mock", True)
        ),
        "rdkit-descriptors": lambda payload: calculate_descriptors(payload["smiles"], "rdkit", payload.get("allow_mock", True)),
        "mordred-descriptors": lambda payload: calculate_descriptors(payload["smiles"], "mordred", payload.get("allow_mock", True)),
        "calculate-required-descriptors": lambda payload: calculate_required_descriptors(
            payload["smiles"],
            require_rdkit=payload.get("require_rdkit", True),
            require_mordred=payload.get("require_mordred", True),
            allow_mock=payload.get("allow_mock", False),
        ),
        "visualize": lambda payload: visualize_from_smiles(payload["smiles"]),
        "generate-3d": lambda payload: generate_3d_from_smiles(
            payload["smiles"],
            add_hydrogens=payload.get("add_hydrogens", True),
            optimize=payload.get("optimize", True),
            force_field=payload.get("force_field", "MMFF"),
        ),
        "convert-format": lambda payload: convert_molecule_format(
            payload["input_text"], payload["input_format"], payload["output_format"]
        ),
        "import-excel": lambda payload: preview_table_file(payload["file_path"], payload.get("preview_rows", 20)),
        "predict": lambda payload: predict_additive_screening(payload),
        "optimize-formulation": lambda payload: optimize_formulation_mock(payload),
    }


if __name__ == "__main__":
    raise SystemExit(main())
