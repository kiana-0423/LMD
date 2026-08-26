import type { DescriptorJob, ExportResult, MLDescriptorMatrixOptions, MoleculeDescriptor } from "../../types";
import { invokeCommand } from "../tauri";
import { unwrapExport } from "./export";

/**
 * `includeValues` stays off by default: a Mordred record carries ~1,800 values and the status
 * views read none of them.
 */
export async function listMoleculeDescriptors(moleculeId?: string, includeValues = false) {
  return invokeCommand<MoleculeDescriptor[]>("list_molecule_descriptors", {
    moleculeId: moleculeId ?? null,
    moleculeIds: null,
    includeValues
  });
}

/**
 * Descriptor records for a named set of molecules, in one query.
 *
 * The descriptor centre shows the status of every molecule on the current page. Asking per
 * molecule meant one IPC round trip per row; asking for all of them meant reading every descriptor
 * record in the workspace to display twenty-five.
 */
export async function listDescriptorsForMolecules(moleculeIds: string[], includeValues = false) {
  if (moleculeIds.length === 0) return [] as MoleculeDescriptor[];
  return invokeCommand<MoleculeDescriptor[]>("list_molecule_descriptors", {
    moleculeId: null,
    moleculeIds,
    includeValues
  });
}

/** Exports read SQLite through Rust and are written into the workspace `exports/` directory. */
export async function exportAllDescriptorsCsv(): Promise<ExportResult> {
  return unwrapExport(invokeCommand("export_all_descriptors_csv", {}), "all-descriptors.csv");
}

export async function exportMlDescriptorMatrixCsv(
  options: MLDescriptorMatrixOptions
): Promise<ExportResult> {
  return unwrapExport(
    invokeCommand("export_ml_descriptor_matrix_csv", { options }),
    "ml-descriptor-matrix.csv"
  );
}

export async function recalculateAllDescriptors() {
  return invokeCommand("recalculate_all_descriptors", {});
}

export async function recalculateFailedDescriptors() {
  return invokeCommand("recalculate_failed_descriptors", {});
}

/** Descriptor batch history, read from the jobs table. */
export async function listDescriptorJobs(limit = 10) {
  const value = await invokeCommand<{ data?: { items: DescriptorJob[] } } & { items?: DescriptorJob[] }>(
    "list_descriptor_jobs",
    { limit }
  );
  return (value?.data ?? value)?.items ?? [];
}

export async function calculateDescriptorsForMolecules(moleculeIds: string[]) {
  return invokeCommand("batch_calculate_descriptors", {
    moleculeIds,
    descriptorSets: ["rdkit", "mordred"]
  });
}
