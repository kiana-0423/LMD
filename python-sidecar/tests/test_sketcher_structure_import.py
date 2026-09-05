import pytest
from rdkit import Chem
from rdkit.Chem import AllChem

from lmd_sidecar.services.visualization_service import convert_molecule_format
from test_mol2_import import mol2_fixture, materials_studio_fixture


@pytest.mark.parametrize("smiles", ["CCO", "c1ccccc1", "F[C@H](Cl)Br"])
def test_pdb_import_produces_editable_2d_mol_and_metadata(smiles):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    assert AllChem.EmbedMolecule(mol, randomSeed=42) == 0
    pdb = Chem.MolToPDBBlock(mol)
    result, _ = convert_molecule_format(pdb, "pdb", "mol", generate_2d=True)
    drawing = Chem.MolFromMolBlock(result["content"])
    assert drawing is not None
    assert not drawing.GetConformer().Is3D()
    assert Chem.MolToSmiles(drawing) == Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    assert result["canonical_smiles"] == Chem.MolToSmiles(drawing)
    assert result["formula"]
    assert result["molecular_weight"] > 0


@pytest.mark.parametrize("smiles", ["COP(=O)(OC)OC", "F[C@H](Cl)Br"])
def test_mol2_import_preserves_identity_and_stereochemistry_in_editable_mol(smiles):
    result, _ = convert_molecule_format(mol2_fixture(smiles), "mol2", "mol", generate_2d=True)
    drawing = Chem.MolFromMolBlock(result["content"])
    assert Chem.MolToSmiles(drawing) == Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    assert not drawing.GetConformer().Is3D()


def test_mol2_inference_is_retained_for_editor_review():
    result, warnings = convert_molecule_format(materials_studio_fixture("c1ccccc1"), "mol2", "mol", generate_2d=True)
    assert len(result["inferred_bond_ids"]) == 6
    assert warnings
    assert result["formula"] == "C6H6"


def test_multi_model_pdb_is_rejected_instead_of_discarding_models():
    pdb = Chem.MolToPDBBlock(Chem.MolFromSmiles("CCO"))
    with pytest.raises(ValueError, match="one PDB model"):
        convert_molecule_format(f"MODEL        1\n{pdb}\nENDMDL\nMODEL        2\n{pdb}\nENDMDL", "pdb", "mol", generate_2d=True)


def test_mol_header_empty_title_is_not_stripped():
    block = Chem.MolToMolBlock(Chem.MolFromSmiles("CCO"))
    assert block.startswith("\n")
    data, _ = convert_molecule_format(block, "mol", "smiles")
    assert data["content"] == "CCO"


def test_normal_export_keeps_input_3d_coordinates():
    result, _ = convert_molecule_format(mol2_fixture("CCO"), "mol2", "mol")
    assert Chem.MolFromMolBlock(result["content"]).GetConformer().Is3D()
