from __future__ import annotations

from typing import Any

from .rdkit_service import safe_import_rdkit, standardize_molecule


def visualize_from_smiles(smiles: str) -> tuple[dict[str, Any], list[str]]:
    rdkit = _require_rdkit()
    standardized, warnings = standardize_molecule(smiles)
    mol = rdkit["Chem"].MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"RDKit could not parse the SMILES {smiles!r}.")
    svg = molecule_to_svg(mol)
    # An empty drawing is a failure, not a result the caller should store as a structure.
    if not svg.strip() or "<svg" not in svg:
        raise RuntimeError("RDKit returned an empty SVG for this structure.")
    return {**standardized, "svg": svg, "mode": "real"}, warnings


def generate_3d_from_smiles(
    smiles: str,
    add_hydrogens: bool = True,
    optimize: bool = True,
    force_field: str = "MMFF",
) -> tuple[dict[str, Any], list[str]]:
    rdkit = _require_rdkit()
    Chem = rdkit["Chem"]
    AllChem = rdkit["AllChem"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")
    if add_hydrogens:
        mol = Chem.AddHs(mol)
    if AllChem.EmbedMolecule(mol, randomSeed=42) != 0:
        raise RuntimeError(
            "RDKit could not generate 3D coordinates for this structure. Check that the SMILES "
            "describes a complete, connected molecule."
        )
    if optimize:
        if force_field.upper() == "MMFF":
            AllChem.MMFFOptimizeMolecule(mol)
        else:
            AllChem.UFFOptimizeMolecule(mol)
    return molecule_to_blocks(mol), []


SUPPORTED_INPUT_FORMATS = ("smiles", "mol", "sdf", "pdb")
SUPPORTED_OUTPUT_FORMATS = ("smiles", "mol", "sdf", "pdb", "inchi", "inchikey", "svg")


def _parse_structure(rdkit: dict[str, Any], text: str, input_format: str):
    """Reads a structure in any supported input format, or explains why it could not."""
    Chem = rdkit["Chem"]
    text = text.strip()
    if not text:
        raise ValueError("The input structure is empty.")
    if input_format == "smiles":
        mol = Chem.MolFromSmiles(text)
    elif input_format == "mol":
        mol = Chem.MolFromMolBlock(text, sanitize=True, removeHs=False)
    elif input_format == "sdf":
        # Take the first record; an SDF may hold many.
        block = text.split("$$$$")[0]
        mol = Chem.MolFromMolBlock(block, sanitize=True, removeHs=False)
    elif input_format == "pdb":
        mol = Chem.MolFromPDBBlock(text, sanitize=True, removeHs=False)
    else:
        raise ValueError(
            f"Unsupported input format {input_format!r}. Use one of: "
            + ", ".join(SUPPORTED_INPUT_FORMATS)
        )
    if mol is None:
        raise ValueError(f"RDKit could not parse the input as {input_format.upper()}.")
    return mol


def convert_molecule_format(
    input_text: str, input_format: str, output_format: str
) -> tuple[dict[str, Any], list[str]]:
    rdkit = _require_rdkit()
    Chem = rdkit["Chem"]
    AllChem = rdkit["AllChem"]
    input_format = (input_format or "").strip().lower()
    output_format = (output_format or "").strip().lower()
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise ValueError(
            f"Unsupported output format {output_format!r}. Use one of: "
            + ", ".join(SUPPORTED_OUTPUT_FORMATS)
        )

    mol = _parse_structure(rdkit, input_text, input_format)
    warnings: list[str] = []

    # MOL, SDF and PDB all need coordinates. SMILES carries none, so generate them.
    needs_coordinates = output_format in {"mol", "sdf", "pdb"}
    if needs_coordinates and mol.GetNumConformers() == 0:
        if output_format == "pdb":
            prepared = Chem.AddHs(mol)
            if AllChem.EmbedMolecule(prepared, randomSeed=42) != 0:
                raise RuntimeError(
                    "RDKit could not generate the 3D coordinates a PDB block requires."
                )
            AllChem.MMFFOptimizeMolecule(prepared)
            mol = prepared
            warnings.append("3D coordinates were generated because the input had none.")
        else:
            AllChem.Compute2DCoords(mol)
            warnings.append("2D coordinates were generated because the input had none.")

    if output_format == "smiles":
        content = Chem.MolToSmiles(mol, canonical=True)
    elif output_format == "mol":
        content = Chem.MolToMolBlock(mol)
    elif output_format == "sdf":
        content = Chem.MolToMolBlock(mol) + "\n$$$$\n"
    elif output_format == "pdb":
        content = Chem.MolToPDBBlock(mol)
    elif output_format == "inchi":
        content = Chem.MolToInchi(mol)
    elif output_format == "inchikey":
        content = Chem.MolToInchiKey(mol)
    else:
        content = molecule_to_svg(mol)

    if not content or not content.strip():
        raise RuntimeError(
            f"RDKit produced empty {output_format.upper()} output for this structure."
        )
    return {
        "input_format": input_format,
        "output_format": output_format,
        "content": content,
        "mode": "real",
    }, warnings


def molecule_to_svg(mol) -> str:
    rdkit = _require_rdkit()
    drawer = rdkit["rdMolDraw2D"].MolDraw2DSVG(420, 260)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def molecule_to_blocks(mol) -> dict[str, Any]:
    rdkit = _require_rdkit()
    Chem = rdkit["Chem"]
    return {
        "mode": "real",
        "mol_block": Chem.MolToMolBlock(mol),
        "sdf_block": Chem.MolToMolBlock(mol) + "\n$$$$\n",
        "pdb_block": Chem.MolToPDBBlock(mol),
    }


def _require_rdkit() -> dict[str, Any]:
    """Visualization and conversion have no honest fallback, so a missing RDKit is an error."""
    rdkit = safe_import_rdkit()
    if not rdkit["ok"]:
        raise RuntimeError(
            "RDKit is required for structure visualization and conversion but is not available "
            f"in the packaged sidecar: {rdkit['error']}"
        )
    return rdkit
