from __future__ import annotations

from typing import Any

from .mordred_service import calculate_mordred_descriptors
from .rdkit_service import calculate_rdkit_descriptors, standardize_molecule


def calculate_descriptors(smiles: str, descriptor_set: str, allow_mock: bool = True) -> tuple[dict[str, Any], list[str]]:
    if descriptor_set == "rdkit":
        return calculate_rdkit_descriptors(smiles)
    if descriptor_set == "mordred":
        return calculate_mordred_descriptors(smiles, ignore_3d=True, allow_mock=allow_mock)
    raise ValueError(f"Unsupported descriptor_set: {descriptor_set}")


def calculate_required_descriptors(
    smiles: str,
    require_rdkit: bool = True,
    require_mordred: bool = True,
    allow_mock: bool = False,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    standardized, rdkit_warnings = standardize_molecule(smiles)
    warnings.extend(rdkit_warnings)
    data: dict[str, Any] = {**standardized}
    if require_rdkit:
        rdkit, rdkit_descriptor_warnings = calculate_rdkit_descriptors(smiles)
        data["rdkit"] = rdkit
        warnings.extend(rdkit_descriptor_warnings)
    if require_mordred:
        mordred, mordred_warnings = calculate_mordred_descriptors(smiles, ignore_3d=True, allow_mock=allow_mock)
        data["mordred"] = mordred
        warnings.extend(mordred_warnings)
    return data, warnings
