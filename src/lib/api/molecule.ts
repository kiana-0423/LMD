import type { Molecule } from "../../types";
import {
  mockDeleteMolecule,
  mockGenerateMolecule3d,
  mockGetMolecule,
  mockListMolecules,
  mockSaveMoleculeWithRequiredDescriptors,
  type SaveMoleculeWithRequiredDescriptorsPayload
} from "../api.mock";
import { invokeOrMock } from "../tauri";

export async function listMolecules() {
  return invokeOrMock<Molecule[]>("list_molecules", { filter: null }, mockListMolecules);
}

export async function getMolecule(id: string) {
  return invokeOrMock<Molecule | undefined>("get_molecule", { id }, () => mockGetMolecule(id));
}

export async function generateMolecule3d(smiles: string) {
  return invokeOrMock<{ data?: Record<string, string>; mol_block?: string; sdf_block?: string; pdb_block?: string; mode?: string }>(
    "generate_molecule_3d",
    { smiles },
    () => mockGenerateMolecule3d(smiles)
  ).then((value) => value.data ?? value);
}

export async function deleteMolecule(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_molecule", { id }, () => mockDeleteMolecule(id));
}

export async function saveMoleculeWithRequiredDescriptors(payload: SaveMoleculeWithRequiredDescriptorsPayload) {
  return invokeOrMock<Molecule>("save_molecule_with_required_descriptors", { payload }, () =>
    mockSaveMoleculeWithRequiredDescriptors(payload)
  );
}
