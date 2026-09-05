import json
from pathlib import Path
import subprocess
import sys

import pytest
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem import rdMolDescriptors

from lmd_sidecar.services.visualization_service import convert_molecule_format


ETHANOL = (Path(__file__).parent / "fixtures" / "ethanol.mol2").read_text()


def test_mol2_uses_structure_not_smiles_comment():
    data, warnings = convert_molecule_format("# SMILES: CCCCC\n" + ETHANOL, "mol2", "smiles")
    assert data["content"] == "CCO"
    assert data["mode"] == "real"
    assert warnings == []


def test_mol2_accepts_bom_crlf_and_case_normalized_format():
    data, _ = convert_molecule_format("\ufeff" + ETHANOL.replace("\n", "\r\n"), " MOL2 ", "SMILES")
    assert data["content"] == "CCO"


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_final_bond_is_retained_without_a_substructure_section_or_trailing_newline(newline):
    block = ETHANOL.split("@<TRIPOS>SUBSTRUCTURE")[0].rstrip().replace("\n", newline)
    data, warnings = convert_molecule_format(block, "mol2", "smiles")
    assert data["content"] == "CCO"
    assert not warnings


@pytest.mark.parametrize("block", ["", "not mol2", ETHANOL + ETHANOL,
    ETHANOL.replace("C.3", "Unknown.type"), ETHANOL.split("@<TRIPOS>ATOM")[0]])
def test_mol2_rejects_unusable_or_multiple_records(block):
    with pytest.raises((ValueError, RuntimeError)):
        convert_molecule_format(block, "mol2", "smiles")


def mol2_fixture(smiles):
    """Small explicit-H fixtures with known Tripos types and deterministic coordinates."""
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    assert AllChem.EmbedMolecule(mol, randomSeed=42) == 0
    lines = ["@<TRIPOS>MOLECULE", "fixture", f"{mol.GetNumAtoms()} {mol.GetNumBonds()} 1 0 0",
             "SMALL", "NO_CHARGES", "", "@<TRIPOS>ATOM"]
    types = {"C": "C.3", "O": "O.3", "N": "N.3", "S": "S.3", "P": "P.3", "H": "H", "F": "F", "Cl": "Cl", "Br": "Br"}
    for atom in mol.GetAtoms():
        kind = types[atom.GetSymbol()]
        if atom.GetIsAromatic():
            kind = atom.GetSymbol() + ".ar"
        elif atom.GetSymbol() in {"C", "O"} and any(b.GetBondTypeAsDouble() == 2 for b in atom.GetBonds()):
            kind = atom.GetSymbol() + ".2"
        p = mol.GetConformer().GetAtomPosition(atom.GetIdx())
        lines.append(f"{atom.GetIdx()+1} {atom.GetSymbol()}{atom.GetIdx()+1} {p.x:.4f} {p.y:.4f} {p.z:.4f} {kind} 1 MOL 0.0")
    lines.append("@<TRIPOS>BOND")
    for bond in mol.GetBonds():
        kind = "ar" if bond.GetIsAromatic() else str(int(bond.GetBondTypeAsDouble()))
        lines.append(f"{bond.GetIdx()+1} {bond.GetBeginAtomIdx()+1} {bond.GetEndAtomIdx()+1} {kind}")
    lines.extend(["@<TRIPOS>SUBSTRUCTURE", "1 MOL 1", ""])
    return "\n".join(lines)


@pytest.mark.parametrize("smiles", ["c1ccccc1", "COP(=O)(OC)OC", "F[C@H](Cl)Br"])
def test_mol2_preserves_aromaticity_phosphate_and_3d_stereochemistry(smiles):
    result, _ = convert_molecule_format(mol2_fixture(smiles), "mol2", "smiles")
    assert result["content"] == Chem.MolToSmiles(Chem.MolFromSmiles(smiles))


def materials_studio_fixture(smiles):
    block = mol2_fixture(smiles).split("@<TRIPOS>SUBSTRUCTURE")[0]
    return block.replace("C.ar", "C.2").replace("N.ar", "N.2").replace(" ar\n", " un\n").rstrip()


@pytest.mark.parametrize("smiles", ["c1ccncc1", "CNc1nc(NC)nc(NC)n1"])
def test_unknown_six_member_heteroaromatic_bonds_are_disclosed_and_preserved(smiles):
    data, _ = convert_molecule_format(materials_studio_fixture(smiles), "mol2", "smiles")
    assert data["content"] == Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    assert len(data["inferred_bond_ids"]) == 6


@pytest.mark.parametrize("smiles", [
    "CC(=O)OC[C@H](O)CO", "CSCC[C@@H](N)C(=O)O", "COP(=O)(OC)OC",
    "COC(=O)CNc1nc(NCC(=O)OC)nc(NCC(=O)OC)n1",
])
def test_mistyped_oxygen_in_esters_acids_phosphates_and_triazines(smiles):
    block = materials_studio_fixture(smiles).replace("O.2", "O.co2").replace("O.3", "O.co2")
    data, warnings = convert_molecule_format(block, "mol2", "mol", generate_2d=True)
    original = Chem.MolFromSmiles(smiles)
    restored = Chem.MolFromMolBlock(data["content"])
    # Check identity including stereochemistry through the actual editor format.
    assert Chem.MolToSmiles(restored) == Chem.MolToSmiles(original)
    assert data["formula"] == rdMolDescriptors.CalcMolFormula(original)
    assert Chem.GetFormalCharge(restored) == 0
    assert not any(a.GetNumRadicalElectrons() for a in restored.GetAtoms())
    assert len(data["normalized_atom_types"]) == sum(a.GetSymbol() == "O" for a in original.GetAtoms())
    assert any("normalized oxygen atom types" in warning for warning in warnings)


def test_true_carboxylate_keeps_its_negative_charge_and_is_not_normalized():
    block = mol2_fixture("CC(=O)[O-]").replace("O.2", "O.co2").replace("O.3", "O.co2")
    data, _ = convert_molecule_format(block, "mol2", "smiles")
    assert data["content"] == "CC(=O)[O-]"
    assert data["normalized_atom_types"] == []


def test_comments_blank_lines_and_sparse_reordered_ids_preserve_connectivity():
    lines = ETHANOL.split("@<TRIPOS>SUBSTRUCTURE")[0].splitlines()
    section = ""
    for index, line in enumerate(lines):
        if line.startswith("@<TRIPOS>"):
            section = line[9:]
        elif section == "ATOM" and line.strip():
            row = line.split()
            row[0] = str(100 - int(row[0]) * 3)
            lines[index] = " ".join(row)
        elif section == "BOND" and line.strip():
            row = line.split()
            row[1:3] = [str(100 - int(value) * 3) for value in row[1:3]]
            lines[index] = " ".join(row)
    data, _ = convert_molecule_format("\n\n# exporter comment\n".join(lines), "mol2", "smiles")
    assert data["content"] == "CCO"


@pytest.mark.parametrize("before,after,reason", [
    ("1 1 2 1", "1 1 99 1", "missing atom"),
    ("1 1 2 1", "1 1 1 1", "itself"),
    ("1 1 2 1", "1 1 2 du", "unsupported type"),
])
def test_record_errors_are_diagnosed_before_rdkit(before, after, reason):
    assert before in ETHANOL
    with pytest.raises(ValueError, match=reason):
        convert_molecule_format(ETHANOL.replace(before, after), "mol2", "smiles")


def test_materials_studio_2246_bond_convention_with_disclosed_inference():
    # Synthetic coordinates, same connectivity and export conventions as the failing file.
    expected = "Cc1cc(Cc2cc(C)cc(C(C)(C)C)c2O)c(O)c(C(C)(C)C)c1"
    result, warnings = convert_molecule_format(materials_studio_fixture(expected), "mol2", "smiles")
    assert result["content"] == Chem.MolToSmiles(Chem.MolFromSmiles(expected))
    mol = Chem.MolFromSmiles(result["content"])
    assert rdMolDescriptors.CalcMolFormula(mol) == "C23H32O2"
    assert Chem.GetFormalCharge(mol) == 0
    assert sum(atom.GetNumRadicalElectrons() for atom in mol.GetAtoms()) == 0
    assert len(result["inferred_bond_ids"]) == 12
    assert "inferred aromatic bond orders for 12" in warnings[0]
    assert "~" not in result["content"]


@pytest.mark.parametrize("block", [
    ETHANOL.replace("1 1 2 1", "1 1 2 un"),
    materials_studio_fixture("c1ccccc1").replace("C.2", "C.3"),
    materials_studio_fixture("c1ccc2ccccc2c1"),
    materials_studio_fixture("c1ccccc1").replace("C.2", "N.2", 1),
])
def test_other_unknown_bond_patterns_are_not_guessed(block):
    with pytest.raises(ValueError, match="cannot be inferred safely"):
        convert_molecule_format(block, "mol2", "smiles")


def test_inference_refuses_mismatched_counts():
    block = materials_studio_fixture("c1ccccc1").replace("12 12 1 0 0", "13 12 1 0 0")
    with pytest.raises(ValueError, match="counts do not match"):
        convert_molecule_format(block, "mol2", "smiles")


def test_real_cli_conversion_and_failure_envelopes(tmp_path):
    for block, success in [(ETHANOL, True), (ETHANOL + ETHANOL, False)]:
        payload = tmp_path / "input.json"
        payload.write_text(json.dumps({"input_text": block, "input_format": "mol2", "output_format": "smiles"}))
        result = subprocess.run(
            [sys.executable, "-m", "lmd_sidecar.main", "convert-format", "--input", str(payload)],
            text=True, capture_output=True, check=False,
            cwd=Path(__file__).resolve().parents[1],
        )
        envelope = json.loads(result.stdout)
        assert envelope["ok"] is success
        assert result.returncode == (0 if success else 1)
        if success:
            assert envelope["data"]["content"] == "CCO"
        else:
            assert envelope["error"]["code"] == "structure.processingFailed"
