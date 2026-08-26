from __future__ import annotations

from typing import Any

from .mordred_service import calculate_mordred_descriptors
from .rdkit_service import calculate_rdkit_descriptors, standardize_molecule


def calculate_descriptors(smiles: str, descriptor_set: str) -> tuple[dict[str, Any], list[str]]:
    if descriptor_set == "rdkit":
        return calculate_rdkit_descriptors(smiles)
    if descriptor_set == "mordred":
        return calculate_mordred_descriptors(smiles, ignore_3d=True)
    raise ValueError(f"Unsupported descriptor_set: {descriptor_set}")


def calculate_required_descriptors(
    smiles: str,
    require_rdkit: bool = True,
    require_mordred: bool = True,
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
        mordred, mordred_warnings = calculate_mordred_descriptors(smiles, ignore_3d=True)
        data["mordred"] = mordred
        warnings.extend(mordred_warnings)
    return data, warnings


def calculate_required_descriptors_batch(
    items: list[dict[str, Any]],
    require_rdkit: bool = True,
    require_mordred: bool = True,
) -> tuple[dict[str, Any], list[str]]:
    """Calculate many molecules in one sidecar process.

    Failures are isolated per molecule so a single invalid SMILES does not
    discard successful calculations from the same batch.
    """
    results: list[dict[str, Any]] = []
    success_count = 0
    for item in items:
        molecule_id = str(item.get("molecule_id", ""))
        smiles = str(item.get("smiles", "")).strip()
        try:
            if not molecule_id:
                raise ValueError("molecule_id is required.")
            if not smiles:
                raise ValueError("SMILES is required.")
            data, warnings = calculate_required_descriptors(
                smiles,
                require_rdkit=require_rdkit,
                require_mordred=require_mordred,
            )
            results.append(
                {
                    "molecule_id": molecule_id,
                    "ok": True,
                    "data": data,
                    "warnings": warnings,
                }
            )
            success_count += 1
        except Exception as exc:
            results.append(
                {
                    "molecule_id": molecule_id,
                    "ok": False,
                    "error": str(exc),
                    "warnings": [],
                }
            )
    return {
        "items": results,
        "success_count": success_count,
        "failed_count": len(results) - success_count,
    }, []
