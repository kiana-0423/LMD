"""Everything one molecule needs, computed once from one parsed structure.

Saving a molecule used to start the sidecar four or five times: `validate-smiles`, then
`visualize`, then `smiles-to-molfile`, then `calculate-required-descriptors`, and `generate-3d` if
3D was wanted. The sidecar is a one-file PyInstaller bundle, so every one of those paid the full
cost of unpacking and importing RDKit, Mordred, NumPy and pandas before it did any chemistry — and
each one re-parsed the same SMILES into a fresh RDKit molecule to do it.

This runs the whole sequence in one process against one parsed molecule. Nothing about the
chemistry changes: each step calls the same code it always did, and a step that fails still fails
with the same structured error. What disappears is four process starts and four redundant parses.

The molecule object is shared only where sharing is safe. `Compute2DCoords` and `AddHs` both mutate
the molecule they are given, so those steps work on copies — a 2D layout computed for the SVG must
not leak into the descriptor calculation, and the hydrogens added for a 3D embedding must not
appear in the molfile.
"""

from __future__ import annotations

from typing import Any

from .mordred_service import calculate_mordred_descriptors
from .rdkit_service import calculate_rdkit_descriptors, count_elements, require_rdkit


def prepare_molecule(
    smiles: str,
    *,
    include_svg: bool = True,
    include_molfile: bool = True,
    include_3d: bool = False,
    require_rdkit_descriptors: bool = True,
    require_mordred_descriptors: bool = True,
    force_field: str = "MMFF",
) -> tuple[dict[str, Any], list[str]]:
    smiles = (smiles or "").strip()
    if not smiles:
        raise ValueError("SMILES is required.")

    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    AllChem = rdkit["AllChem"]
    Descriptors = rdkit["Descriptors"]

    # The one parse. Every step below reads from this molecule or from a copy of it.
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES.")

    warnings: list[str] = []
    data: dict[str, Any] = {
        "smiles_raw": smiles,
        "smiles_canonical": Chem.MolToSmiles(mol, canonical=True),
        "inchi": Chem.MolToInchi(mol),
        "inchi_key": Chem.MolToInchiKey(mol),
        "formula": rdkit["rdMolDescriptors"].CalcMolFormula(mol),
        "molecular_weight": Descriptors.MolWt(mol),
        "element_counts": count_elements(mol),
        "mode": "real",
        "valid": True,
    }

    if include_svg:
        # A copy: the 2D layout this needs would otherwise become part of every later step.
        flat = Chem.Mol(mol)
        AllChem.Compute2DCoords(flat)
        drawer = rdkit["rdMolDraw2D"].MolDraw2DSVG(420, 260)
        drawer.DrawMolecule(flat)
        drawer.FinishDrawing()
        svg = drawer.GetDrawingText()
        # An empty drawing is a failure, not a structure worth storing.
        if not svg.strip() or "<svg" not in svg:
            raise RuntimeError("RDKit returned an empty SVG for this structure.")
        data["svg"] = svg
        if include_molfile:
            # The same 2D layout the picture was drawn from, so the file and the image agree.
            data["molfile"] = Chem.MolToMolBlock(flat)
    elif include_molfile:
        flat = Chem.Mol(mol)
        AllChem.Compute2DCoords(flat)
        data["molfile"] = Chem.MolToMolBlock(flat)

    if include_3d:
        # Hydrogens and an embedding, on their own copy.
        three_d = Chem.AddHs(Chem.Mol(mol))
        if AllChem.EmbedMolecule(three_d, randomSeed=42) != 0:
            # A failed embedding is reported rather than raised: the 2D structure and the
            # descriptors are real results, and discarding them because a 3D conformer could not
            # be found would be throwing away work that succeeded.
            warnings.append(
                "RDKit could not generate 3D coordinates for this structure; the 2D structure and "
                "descriptors were still calculated."
            )
            data["three_d"] = None
        else:
            if force_field.upper() == "MMFF":
                AllChem.MMFFOptimizeMolecule(three_d)
            else:
                AllChem.UFFOptimizeMolecule(three_d)
            data["three_d"] = {
                "mol_block": Chem.MolToMolBlock(three_d),
                "sdf_block": Chem.MolToMolBlock(three_d) + "\n$$$$\n",
                "pdb_block": Chem.MolToPDBBlock(three_d),
                "mode": "real",
            }

    # The descriptor policy is unchanged: a required set that cannot be calculated is an error,
    # not a molecule saved with a gap where its descriptors should be.
    if require_rdkit_descriptors:
        rdkit_descriptors, rdkit_warnings = calculate_rdkit_descriptors(smiles)
        data["rdkit"] = rdkit_descriptors
        warnings.extend(rdkit_warnings)
    if require_mordred_descriptors:
        mordred_descriptors, mordred_warnings = calculate_mordred_descriptors(smiles, ignore_3d=True)
        data["mordred"] = mordred_descriptors
        warnings.extend(mordred_warnings)

    return data, warnings
