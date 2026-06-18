from __future__ import annotations

from typing import Any


def safe_import_rdkit():
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, Descriptors, Lipinski, rdMolDescriptors
        from rdkit.Chem.Draw import rdMolDraw2D

        return {
            "ok": True,
            "Chem": Chem,
            "AllChem": AllChem,
            "Descriptors": Descriptors,
            "Lipinski": Lipinski,
            "rdMolDescriptors": rdMolDescriptors,
            "rdMolDraw2D": rdMolDraw2D,
        }
    except Exception as exc:  # pragma: no cover - depends on optional local deps
        return {"ok": False, "error": str(exc)}


def standardize_molecule(smiles: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        warnings = [f"RDKit unavailable; returning development mock data: {rdkit['error']}"]
        return _mock_standardized(smiles), warnings
    Chem = rdkit["Chem"]
    Descriptors = rdkit["Descriptors"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")
    smiles_canonical = Chem.MolToSmiles(mol, canonical=True)
    inchi = Chem.MolToInchi(mol)
    inchi_key = Chem.MolToInchiKey(mol)
    formula = rdkit["rdMolDescriptors"].CalcMolFormula(mol)
    return {
        "smiles_raw": smiles,
        "smiles_canonical": smiles_canonical,
        "inchi": inchi,
        "inchi_key": inchi_key,
        "formula": formula,
        "molecular_weight": Descriptors.MolWt(mol),
        "mode": "real",
    }, []


def validate_smiles(smiles: str) -> tuple[dict[str, Any], list[str]]:
    try:
        standardized, warnings = standardize_molecule(smiles)
        return {"valid": True, **standardized}, warnings
    except Exception as exc:
        return {"valid": False, "error": str(exc)}, []


def molfile_to_smiles(molfile: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    if not molfile.strip():
        return {"valid": False, "error": "Molfile is empty."}, []
    if not rdkit["ok"]:
        return {"valid": False, "error": f"RDKit unavailable: {rdkit['error']}"}, []
    Chem = rdkit["Chem"]
    mol = Chem.MolFromMolBlock(molfile, sanitize=True, removeHs=False)
    if mol is None:
        return {"valid": False, "error": "RDKit could not parse Molfile."}, []
    smiles = Chem.MolToSmiles(mol, canonical=True)
    standardized, warnings = standardize_molecule(smiles)
    return {"valid": True, **standardized}, warnings


def smiles_to_molfile(smiles: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        return {"valid": False, "error": f"RDKit unavailable: {rdkit['error']}"}, []
    Chem = rdkit["Chem"]
    AllChem = rdkit["AllChem"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"valid": False, "error": "Invalid SMILES."}, []
    AllChem.Compute2DCoords(mol)
    canonical = Chem.MolToSmiles(mol, canonical=True)
    return {
        "valid": True,
        "molfile": Chem.MolToMolBlock(mol),
        "canonical_smiles": canonical,
    }, []


def calculate_rdkit_descriptors(smiles: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        warnings = [f"RDKit unavailable; returning development mock descriptors: {rdkit['error']}"]
        descriptors = _mock_rdkit_descriptors(smiles)
        return {
            "descriptor_set": "rdkit",
            "descriptor_version": "2026.mock",
            "descriptor_count": len(descriptors),
            "mode": "mock",
            "descriptors": descriptors,
        }, warnings

    Chem = rdkit["Chem"]
    Descriptors = rdkit["Descriptors"]
    Lipinski = rdkit["Lipinski"]
    rdMolDescriptors = rdkit["rdMolDescriptors"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")
    elements = count_elements(mol)
    descriptors = {
        "MolWt": Descriptors.MolWt(mol),
        "ExactMolWt": Descriptors.ExactMolWt(mol),
        "MolLogP": Descriptors.MolLogP(mol),
        "TPSA": rdMolDescriptors.CalcTPSA(mol),
        "NumHDonors": Lipinski.NumHDonors(mol),
        "NumHAcceptors": Lipinski.NumHAcceptors(mol),
        "NumRotatableBonds": Lipinski.NumRotatableBonds(mol),
        "RingCount": rdMolDescriptors.CalcNumRings(mol),
        "HeavyAtomCount": mol.GetNumHeavyAtoms(),
        "FractionCSP3": rdMolDescriptors.CalcFractionCSP3(mol),
        "NumAromaticRings": rdMolDescriptors.CalcNumAromaticRings(mol),
        "NumAliphaticRings": rdMolDescriptors.CalcNumAliphaticRings(mol),
        "NumHeteroatoms": Lipinski.NumHeteroatoms(mol),
        **elements,
    }
    return {
        "descriptor_set": "rdkit",
        "descriptor_version": "2026.06",
        "descriptor_count": len(descriptors),
        "mode": "real",
        "descriptors": descriptors,
    }, []


def calculate_sketcher_descriptors(smiles: str, allow_mock: bool = True) -> tuple[dict[str, Any], list[str]]:
    from .mordred_service import calculate_mordred_descriptors

    warnings: list[str] = []
    try:
        rdkit, rdkit_warnings = calculate_rdkit_descriptors(smiles)
        mordred, mordred_warnings = calculate_mordred_descriptors(smiles, ignore_3d=True, allow_mock=allow_mock)
        warnings.extend(rdkit_warnings)
        warnings.extend(mordred_warnings)
        rdkit_descriptors = rdkit.get("descriptors", {})
        mordred_descriptors = mordred.get("descriptors", {})
        descriptors = {"rdkit": rdkit, "mordred": mordred}
        preview = {
            "MolWt": rdkit_descriptors.get("MolWt"),
            "LogP": rdkit_descriptors.get("MolLogP"),
            "TPSA": rdkit_descriptors.get("TPSA"),
            "HBD": rdkit_descriptors.get("NumHDonors"),
            "HBA": rdkit_descriptors.get("NumHAcceptors"),
            "RotatableBonds": rdkit_descriptors.get("NumRotatableBonds"),
        }
        return {
            "valid": True,
            "descriptor_count": len(rdkit_descriptors) + len(mordred_descriptors),
            "descriptors": descriptors,
            "preview": preview,
            "rdkit_status": "mock" if rdkit.get("mode") == "mock" else "calculated",
            "mordred_status": "mock" if mordred.get("mode") == "mock" else "calculated",
        }, warnings
    except Exception as exc:
        return {
            "valid": False,
            "descriptor_count": 0,
            "descriptors": {},
            "preview": {},
            "error": str(exc),
            "rdkit_status": "failed",
            "mordred_status": "failed",
        }, warnings


def count_elements(mol) -> dict[str, int]:
    symbols = ["C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I", "B", "Si", "Mo", "Zn"]
    counts = {f"Element_{symbol}": 0 for symbol in symbols}
    for atom in mol.GetAtoms():
        key = f"Element_{atom.GetSymbol()}"
        if key in counts:
            counts[key] += 1
    return counts


def mol_to_svg(mol) -> str:
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        return _mock_svg("mock")
    drawer = rdkit["rdMolDraw2D"].MolDraw2DSVG(420, 260)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def _mock_standardized(smiles: str) -> dict[str, Any]:
    return {
        "smiles_raw": smiles,
        "smiles_canonical": smiles.strip(),
        "inchi": f"mock:InChI:{smiles.strip()}",
        "inchi_key": f"MOCK-{abs(hash(smiles)) % 100000000}",
        "formula": "C2H6O" if smiles.strip() == "CCO" else "C1H2",
        "molecular_weight": 46.069 if smiles.strip() == "CCO" else float(len(smiles) * 8 + 18),
        "mode": "mock",
    }


def _mock_rdkit_descriptors(smiles: str) -> dict[str, Any]:
    return {
        "MolWt": 46.069 if smiles.strip() == "CCO" else float(len(smiles) * 8 + 18),
        "ExactMolWt": 46.0419,
        "MolLogP": -0.001,
        "TPSA": 20.23,
        "NumHDonors": 1,
        "NumHAcceptors": 1,
        "NumRotatableBonds": 0,
        "RingCount": 0,
        "HeavyAtomCount": max(1, len(smiles)),
        "FractionCSP3": 1.0,
        "NumAromaticRings": 0,
        "NumAliphaticRings": 0,
        "NumHeteroatoms": 1,
        "Element_C": smiles.count("C"),
        "Element_H": 6,
        "Element_O": smiles.count("O"),
        "Element_N": smiles.count("N"),
        "Element_S": smiles.count("S"),
        "Element_P": smiles.count("P"),
        "Element_F": smiles.count("F"),
        "Element_Cl": smiles.count("Cl"),
        "Element_Br": smiles.count("Br"),
        "Element_I": smiles.count("I"),
        "Element_B": smiles.count("B"),
        "Element_Si": smiles.count("Si"),
        "Element_Mo": smiles.count("Mo"),
        "Element_Zn": smiles.count("Zn"),
    }


def _mock_svg(label: str) -> str:
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><rect width='420' height='260' fill='#f8fafc'/><text x='210' y='130' text-anchor='middle'>{label}</text></svg>"
