from __future__ import annotations

from typing import Any


def _patch_numpy_for_mordred() -> None:
    try:
        import numpy as np

        aliases = {
            "float": float,
            "int": int,
            "bool": bool,
            "object": object,
        }
        for name, value in aliases.items():
            if name not in np.__dict__:
                setattr(np, name, value)
    except Exception:
        return


def _patch_networkx_for_mordred() -> None:
    try:
        import networkx as nx

        if hasattr(nx, "biconnected_component_subgraphs"):
            return

        def biconnected_component_subgraphs(graph: Any, copy: bool = True):
            for component in nx.biconnected_components(graph):
                subgraph = graph.subgraph(component)
                yield subgraph.copy() if copy else subgraph

        nx.biconnected_component_subgraphs = biconnected_component_subgraphs
    except Exception:
        return


def safe_import_mordred():
    try:
        _patch_numpy_for_mordred()
        _patch_networkx_for_mordred()
        from mordred import Calculator, descriptors
        from rdkit import Chem

        return {"ok": True, "Calculator": Calculator, "descriptors": descriptors, "Chem": Chem}
    except Exception as exc:  # pragma: no cover - depends on optional local deps
        return {"ok": False, "error": str(exc)}


def calculate_mordred_descriptors(smiles: str, ignore_3d: bool = True, allow_mock: bool = True) -> tuple[dict[str, Any], list[str]]:
    mordred = safe_import_mordred()
    if not mordred["ok"]:
        if not allow_mock:
            raise RuntimeError("Mordred descriptors are required but Mordred is not installed.")
        descriptors = _mock_mordred_descriptors(smiles)
        return {
            "descriptor_set": "mordred",
            "descriptor_version": "1.2.0-mock",
            "descriptor_count": len(descriptors),
            "ignore_3d": ignore_3d,
            "mode": "mock",
            "descriptors": descriptors,
        }, [f"Mordred unavailable; returning development mock descriptors: {mordred['error']}"]

    mol = mordred["Chem"].MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")
    calculator = mordred["Calculator"](mordred["descriptors"], ignore_3D=ignore_3d)
    result = calculator(mol).asdict()
    return {
        "descriptor_set": "mordred",
        "descriptor_version": "1.2.0",
        "descriptor_count": len(result),
        "ignore_3d": ignore_3d,
        "mode": "real",
        "descriptors": {str(key): value for key, value in result.items()},
    }, []


def _mock_mordred_descriptors(smiles: str) -> dict[str, Any]:
    return {
        "ABC": round(len(smiles) * 1.17, 4),
        "ABCGG": round(len(smiles) * 1.03, 4),
        "nAtom": max(1, len(smiles)),
        "ATS0dv": round(len(smiles) * 7.5, 4),
        "nAcid": 1 if "P" in smiles else 0,
        "nBase": 1 if "N" in smiles else 0,
    }
