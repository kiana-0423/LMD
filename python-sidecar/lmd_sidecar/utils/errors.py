"""Stable error codes returned by the Python sidecar.

The diagnostic remains English because it contains exact paths, values, and library messages. The
code names the situation so the desktop interface can explain it in the selected language.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


SIDECAR_INVALID_INPUT = "sidecar.invalidInput"
SIDECAR_DEPENDENCY_UNAVAILABLE = "sidecar.dependencyUnavailable"
SIDECAR_COMMAND_FAILED = "sidecar.commandFailed"
DESCRIPTOR_CALCULATION_FAILED = "descriptor.calculationFailed"
STRUCTURE_PROCESSING_FAILED = "structure.processingFailed"
IMPORT_FAILED = "import.failed"
EXPORT_FAILED = "export.failed"
MODEL_TRAINING_FAILED = "model.trainingFailed"
MODEL_PREDICTION_FAILED = "model.predictionFailed"
MODEL_LOAD_FAILED = "model.loadFailed"
MODEL_FILE_MISSING = "model.fileMissing"
DESIGN_GENERATION_FAILED = "design.generationFailed"
DESIGN_REQUEST_INVALID = "design.requestInvalid"


@dataclass(frozen=True)
class SidecarError:
    code: str
    detail: str
    params: dict[str, str | int | float]


DESCRIPTOR_COMMANDS = {
    "calculate-sketcher-descriptors",
    "rdkit-descriptors",
    "mordred-descriptors",
    "calculate-required-descriptors",
    "calculate-descriptor-batch",
    # The composite command calculates the required descriptor sets, so a failure inside it is a
    # descriptor failure as far as the interface is concerned.
    "prepare-molecule",
}
STRUCTURE_COMMANDS = {
    "standardize",
    "validate-smiles",
    "molfile-to-smiles",
    "smiles-to-molfile",
    "visualize",
    "generate-3d",
    "convert-format",
}


def classify_error(command: str, exc: Exception) -> SidecarError:
    """Classifies an exception without discarding its actionable diagnostic."""

    detail = str(exc) or type(exc).__name__
    params: dict[str, Any] = {"command": command}

    if isinstance(exc, KeyError):
        return SidecarError(SIDECAR_INVALID_INPUT, detail, params)
    if isinstance(exc, (ImportError, ModuleNotFoundError)) or "not available" in detail.lower():
        return SidecarError(SIDECAR_DEPENDENCY_UNAVAILABLE, detail, params)
    if command in DESCRIPTOR_COMMANDS:
        return SidecarError(DESCRIPTOR_CALCULATION_FAILED, detail, params)
    if command in STRUCTURE_COMMANDS:
        return SidecarError(STRUCTURE_PROCESSING_FAILED, detail, params)
    if command == "import-excel":
        return SidecarError(IMPORT_FAILED, detail, params)
    if command == "export-table-rows":
        return SidecarError(EXPORT_FAILED, detail, params)
    if command == "train-model":
        return SidecarError(MODEL_TRAINING_FAILED, detail, params)
    if command in {"predict-with-model", "assess-candidates"}:
        if isinstance(exc, FileNotFoundError):
            return SidecarError(MODEL_FILE_MISSING, detail, params)
        return SidecarError(MODEL_PREDICTION_FAILED, detail, params)
    if command in {"design-generate", "design-templates", "design-validate"}:
        if isinstance(exc, (TypeError, ValueError)):
            return SidecarError(DESIGN_REQUEST_INVALID, detail, params)
        return SidecarError(DESIGN_GENERATION_FAILED, detail, params)
    if command == "describe-model":
        if isinstance(exc, FileNotFoundError):
            return SidecarError(MODEL_FILE_MISSING, detail, params)
        return SidecarError(MODEL_LOAD_FAILED, detail, params)
    if isinstance(exc, (TypeError, ValueError)):
        return SidecarError(SIDECAR_INVALID_INPUT, detail, params)
    return SidecarError(SIDECAR_COMMAND_FAILED, detail, params)
