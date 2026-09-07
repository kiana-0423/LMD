"""A reproducible teaching case, isolated from the experimental model registry.

Targets are RDKit Wildman–Crippen cLogP calculations, NOT measurements. This
small, deliberately structured collection is for learning the workflow, not for
benchmarking generalisation or making lubricant-performance claims.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from .explanation_service import explain_model
from .ml_service import train_model

EXAMPLE_ID = "rdkit_clogp"
EXAMPLE_VERSION = 1
REFERENCE_URL = "https://www.rdkit.org/docs/source/rdkit.Chem.Crippen.html"


def example_dataset() -> dict[str, Any]:
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

    # Seven chain lengths in six families, plus six aromatic structures: 48
    # unique molecules. No proprietary workspace structures are read here.
    structures = ["C" * length + ending for length in range(2, 9)
                  for ending in ("", "O", "N", "C(=O)O", "C(=O)C", "OC(=O)C")]
    structures += ["c1ccccc1", "Cc1ccccc1", "Oc1ccccc1", "Nc1ccccc1", "CCc1ccccc1", "COc1ccccc1"]
    calculators = {
        "rdkit_MolWt": Descriptors.MolWt,
        "rdkit_TPSA": rdMolDescriptors.CalcTPSA,
        "rdkit_NumHAcceptors": Lipinski.NumHAcceptors,
        "rdkit_NumHDonors": Lipinski.NumHDonors,
        "rdkit_NumRotatableBonds": Lipinski.NumRotatableBonds,
        "rdkit_RingCount": Lipinski.RingCount,
        "rdkit_FractionCSP3": rdMolDescriptors.CalcFractionCSP3,
        "rdkit_HeavyAtomCount": Lipinski.HeavyAtomCount,
    }
    rows = []
    seen = set()
    for smiles in structures:
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise ValueError(f"Invalid structure in cLogP case: {smiles}")
        canonical = Chem.MolToSmiles(molecule)
        if canonical in seen:
            raise ValueError(f"Duplicate structure in cLogP case: {canonical}")
        seen.add(canonical)
        rows.append({
            "id": canonical, "label": canonical, "molecule_id": canonical,
            "smiles": canonical,
            "features": {name: float(calculate(molecule)) for name, calculate in calculators.items()},
            # cLogP and its atom-wise contributions are deliberately absent from inputs.
            "target": float(Crippen.MolLogP(molecule)),
        })
    return {
        "target": "rdkit_clogp", "feature_schema_version": "4",
        "concentration_basis": "none", "dataset_mode": "additive_component",
        "interpretation": "Teaching case: predicting a calculated molecular property, not experimental lubricant performance.",
        "feature_order": list(calculators), "rows": rows,
    }


def explain_model_example(_payload: dict[str, Any]) -> tuple[dict[str, Any], list]:
    import rdkit

    dataset = example_dataset()
    # Refit using the installed sklearn version; never ship/load a version-bound
    # pickle or insert these calculated targets into the user's measurements.
    with tempfile.TemporaryDirectory(prefix="lmd-clogp-case-") as directory:
        dataset_path = Path(directory) / "dataset.json"
        model_path = Path(directory) / "model.joblib"
        dataset_path.write_text(json.dumps(dataset), encoding="utf-8")
        trained, _ = train_model({"dataset_path": str(dataset_path), "model_path": str(model_path), "algorithm": "ridge"})
        explanation, _ = explain_model({"model_path": str(model_path), "feature_schema_version": "4"})
    references = {row["id"]: row["target"] for row in dataset["rows"]}
    for sample in explanation["samples"]:
        sample["reference_value"] = references[sample["id"]]
    return {
        "mode": "real", "explanation": explanation,
        "case_study": {
            "id": EXAMPLE_ID, "version": EXAMPLE_VERSION,
            "target_source": "RDKit Wildman–Crippen MolLogP calculation (not experimental)",
            "reference_url": REFERENCE_URL, "rdkit_version": rdkit.__version__,
            "algorithm": trained["algorithm"], "sample_count": trained["sample_count"],
            "feature_count": trained["feature_count"], "split_method": trained["split_method"],
            "metrics": trained["metrics"],
        },
    }, []
