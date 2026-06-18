from __future__ import annotations

from typing import Any

from .rdkit_service import safe_import_rdkit, standardize_molecule


def visualize_from_smiles(smiles: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    standardized, warnings = standardize_molecule(smiles)
    if not rdkit["ok"]:
        return {**standardized, "svg": _mock_svg(smiles), "mode": "mock"}, warnings
    mol = rdkit["Chem"].MolFromSmiles(smiles)
    svg = molecule_to_svg(mol)
    return {**standardized, "svg": svg, "mode": "real"}, warnings


def generate_3d_from_smiles(
    smiles: str,
    add_hydrogens: bool = True,
    optimize: bool = True,
    force_field: str = "MMFF",
) -> tuple[dict[str, Any], list[str]]:
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        return {
            "mode": "mock",
            "mol_block": f"MOCK MOL BLOCK\n{smiles}\n",
            "sdf_block": f"MOCK SDF BLOCK\n{smiles}\n$$$$",
            "pdb_block": f"HEADER MOCK {smiles}\nEND\n",
        }, [f"RDKit unavailable; returning mock 3D blocks: {rdkit['error']}"]
    Chem = rdkit["Chem"]
    AllChem = rdkit["AllChem"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")
    if add_hydrogens:
        mol = Chem.AddHs(mol)
    AllChem.EmbedMolecule(mol, randomSeed=42)
    if optimize:
        if force_field.upper() == "MMFF":
            AllChem.MMFFOptimizeMolecule(mol)
        else:
            AllChem.UFFOptimizeMolecule(mol)
    return molecule_to_blocks(mol), []


def convert_molecule_format(input_text: str, input_format: str, output_format: str) -> tuple[dict[str, Any], list[str]]:
    return {
        "input_format": input_format,
        "output_format": output_format,
        "content": input_text,
        "mode": "mock",
    }, ["Format conversion is mocked in the first MVP."]


def molecule_to_svg(mol) -> str:
    rdkit = safe_import_rdkit()
    drawer = rdkit["rdMolDraw2D"].MolDraw2DSVG(420, 260)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def molecule_to_blocks(mol) -> dict[str, Any]:
    rdkit = safe_import_rdkit()
    Chem = rdkit["Chem"]
    return {
        "mode": "real",
        "mol_block": Chem.MolToMolBlock(mol),
        "sdf_block": Chem.MolToMolBlock(mol) + "\n$$$$\n",
        "pdb_block": Chem.MolToPDBBlock(mol),
    }


def _mock_svg(label: str) -> str:
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><rect width='420' height='260' fill='#f8fafc'/><text x='210' y='130' text-anchor='middle'>{label}</text></svg>"
