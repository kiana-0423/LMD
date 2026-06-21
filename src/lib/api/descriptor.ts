import type { MLDescriptorMatrixOptions, MoleculeDescriptor } from "../../types";
import {
  mockExportAllDescriptorsCsv,
  mockExportMlDescriptorMatrixCsv,
  mockListMoleculeDescriptors,
  mockRecalculateAllDescriptors
} from "../api.mock";
import { invokeOrMock } from "../tauri";

export async function listMoleculeDescriptors(moleculeId?: string) {
  return invokeOrMock<MoleculeDescriptor[]>(
    "list_molecule_descriptors",
    { moleculeId: moleculeId ?? null },
    () => mockListMoleculeDescriptors(moleculeId)
  );
}

export async function exportAllDescriptorsCsv() {
  return mockExportAllDescriptorsCsv();
}

export async function exportMlDescriptorMatrixCsv(options: MLDescriptorMatrixOptions) {
  return mockExportMlDescriptorMatrixCsv(options);
}

export async function recalculateAllDescriptors() {
  return mockRecalculateAllDescriptors();
}
