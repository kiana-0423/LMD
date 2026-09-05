from __future__ import annotations

import json
from typing import Any

from .rdkit_service import safe_import_rdkit, standardize_molecule
from .mol2_service import prepare_mol2


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


SUPPORTED_INPUT_FORMATS = ("smiles", "mol", "mol2", "sdf", "pdb")
SUPPORTED_OUTPUT_FORMATS = ("smiles", "mol", "sdf", "pdb", "inchi", "inchikey", "svg")


def _parse_structure(rdkit: dict[str, Any], text: str, input_format: str):
    """Reads a structure in any supported input format, or explains why it could not."""
    Chem = rdkit["Chem"]
    # MOL/SDF use positional header lines; stripping an empty title corrupts them.
    if not text.strip():
        raise ValueError("The input structure is empty.")
    if input_format == "smiles":
        mol = Chem.MolFromSmiles(text)
    elif input_format == "mol":
        mol = Chem.MolFromMolBlock(text, sanitize=True, removeHs=False)
    elif input_format == "mol2":
        text, inferred, normalized_types = prepare_mol2(text)
        mol = Chem.MolFromMol2Block(text, sanitize=True, removeHs=True)
        if mol is None:
            raise ValueError("MOL2 could not be parsed after format and atom-type normalization. Check atom types, valence and explicit hydrogen/charge information; re-export as MOL/SDF with explicit bond orders if needed.")
        if mol is not None:
            mol.SetProp("_lmd_normalized_mol2_atom_types", json.dumps(normalized_types))
            if any(b.GetBondType() in {Chem.BondType.UNSPECIFIED, Chem.BondType.ZERO} for b in mol.GetBonds()):
                raise ValueError("MOL2 contains unresolved bond orders. Re-export with explicit bond types before importing.")
            if inferred:
                mol.SetProp("_lmd_inferred_mol2_bond_ids", ",".join(inferred))
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
    if mol is None or mol.GetNumAtoms() == 0:
        raise ValueError(f"RDKit could not parse the input as {input_format.upper()}.")
    return mol


def convert_molecule_format(
    input_text: str, input_format: str, output_format: str, generate_2d: bool = False
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

    if generate_2d and input_format == "pdb":
        if sum(line.startswith("MODEL ") for line in input_text.splitlines()) > 1:
            raise ValueError("Import one PDB model at a time. Split multi-model PDB files before editing.")
    mol = _parse_structure(rdkit, input_text, input_format)
    warnings: list[str] = []
    inferred = mol.GetProp("_lmd_inferred_mol2_bond_ids").split(",") if mol.HasProp("_lmd_inferred_mol2_bond_ids") else []
    if inferred:
        warnings.append(
            f"MOL2: inferred aromatic bond orders for {len(inferred)} unknown bonds "
            f"in six-membered sp2 carbon/pyridine-like nitrogen rings (bond IDs: {', '.join(inferred)}). "
            "Review the structure before saving."
        )

    normalized_types = json.loads(mol.GetProp("_lmd_normalized_mol2_atom_types")) if mol.HasProp("_lmd_normalized_mol2_atom_types") else []
    if normalized_types:
        warnings.append("MOL2: normalized oxygen atom types from explicit bond orders (atom IDs and changes: "
                        + ", ".join(normalized_types) + "). Review the structure before saving.")

    editor_metadata = {}
    if generate_2d:
        if mol.GetNumAtoms() > 2000:
            raise ValueError("The drawing editor supports up to 2000 atoms per import. Extract the small molecule before importing.")
        mol = Chem.RemoveHs(mol)
        # Perceive stereochemistry from the input before replacing 3D coordinates.
        standardized, _ = standardize_molecule(Chem.MolToSmiles(mol, canonical=True))
        AllChem.Compute2DCoords(mol, clearConfs=True)
        editor_metadata = {
            "canonical_smiles": standardized["smiles_canonical"],
            "formula": standardized["formula"],
            "molecular_weight": standardized["molecular_weight"],
            "inchi_key": standardized["inchi_key"],
        }

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
        "inferred_bond_ids": inferred,
        "normalized_atom_types": normalized_types,
        **editor_metadata,
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
