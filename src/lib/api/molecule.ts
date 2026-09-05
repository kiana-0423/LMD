import type {
  AttachmentDeletion,
  EntityDeletion,
  FormulationUsage,
  Generated3dResult,
  Molecule,
  MoleculeFiles,
  MoleculeListFilter,
  MoleculePage
} from "../../types";
import type { SaveMoleculeWithRequiredDescriptorsPayload } from "./payloads";
import { toEntityDeletion } from "./deletion";
import { invokeCommand } from "../tauri";
import { coded } from "../backendErrors";

/** Parse the atom/bond records locally; importing does not save a molecule. */
export async function mol2ToSmiles(inputText: string): Promise<{ smiles: string; inferredBondIds: string[]; normalizedAtomTypes: string[] }> {
  const value = await invokeCommand<{ data: { content: string; inferred_bond_ids?: string[]; normalized_atom_types?: string[] } }>("convert_molecule_format", {
    inputText,
    inputFormat: "mol2",
    outputFormat: "smiles"
  });
  const smiles = value?.data?.content?.trim();
  if (!smiles) throw new Error(coded("structure.processingFailed", "MOL2 conversion returned no SMILES."));
  return { smiles, inferredBondIds: value.data.inferred_bond_ids ?? [], normalizedAtomTypes: value.data.normalized_atom_types ?? [] };
}

export async function listMoleculePage(filter: MoleculeListFilter = {}) {
  return invokeCommand<MoleculePage>("list_molecules", { filter });
}

/**
 * Walks every page. Only for whole-library operations such as CSV export — views should page
 * with `listMoleculePage` instead.
 */
export async function listMolecules() {
  const pageSize = 200;
  const first = await listMoleculePage({ page: 1, pageSize });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listMoleculePage({ page, pageSize });
    items.push(...next.items);
    if (next.items.length === 0) break;
  }
  return items;
}

export async function getMolecule(id: string) {
  return invokeCommand<Molecule | undefined>("get_molecule", { id });
}

/**
 * Generates 3D coordinates with the packaged RDKit sidecar and stores them in the workspace.
 * The backend loads the SMILES from SQLite, so the caller passes the molecule id only.
 */
export async function generateMolecule3d(moleculeId: string) {
  const value = await invokeCommand<{ data?: Generated3dResult } & Partial<Generated3dResult>>(
    "generate_molecule_3d",
    { moleculeId }
  );
  return (value?.data ?? value) as Generated3dResult;
}

export async function deleteMolecule(id: string): Promise<EntityDeletion> {
  return toEntityDeletion(await invokeCommand<unknown>("delete_molecule", { id }));
}

export async function saveMoleculeWithRequiredDescriptors(
  payload: SaveMoleculeWithRequiredDescriptorsPayload
) {
  return invokeCommand<Molecule>("save_molecule_with_required_descriptors", { payload });
}

/**
 * Every formulation that uses this molecule — directly, through an additive, or as a base oil's
 * representative structure. Returns an empty array when nothing references it.
 */
export async function listFormulationsForMolecule(moleculeId: string) {
  return invokeCommand<FormulationUsage[]>("list_formulations_for_molecule", { moleculeId });
}

/** Structure files on disk plus the attachment rows recorded against a molecule. */
export async function listMoleculeFiles(moleculeId: string) {
  const value = await invokeCommand<{ data?: MoleculeFiles } & Partial<MoleculeFiles>>(
    "list_molecule_files",
    { moleculeId }
  );
  const data = value?.data ?? value;
  return { structureFiles: data.structureFiles ?? [], attachments: data.attachments ?? [] };
}

export async function importAttachment(options: {
  linkedEntityType: "molecule" | "formulation" | "experiment";
  linkedEntityId: string;
  sourcePath: string;
  description?: string;
}) {
  return invokeCommand("import_attachment", {
    linkedEntityType: options.linkedEntityType,
    linkedEntityId: options.linkedEntityId,
    sourcePath: options.sourcePath,
    description: options.description ?? null
  });
}

/**
 * Copies a workspace file to a destination. The backend refuses to clobber an existing file
 * unless `overwrite` is set, so the caller can ask first.
 */
export async function exportWorkspaceFile(
  relativePath: string,
  destinationPath: string,
  overwrite = false
) {
  return invokeCommand("export_workspace_file", { relativePath, destinationPath, overwrite });
}

/**
 * Deletes one attachment row and the workspace file it owns, for any entity type.
 *
 * This is the only attachment delete in the application — molecules, formulations and experiments
 * all route here, so there is one safe implementation rather than one per caller.
 *
 * `cleanupFailures` is not an error: the database row is gone either way. It names files the
 * backend could not remove from disk, and the caller is expected to show it rather than report an
 * unqualified success.
 */
export async function deleteAttachmentRecord(id: string) {
  const value = await invokeCommand<{ data?: AttachmentDeletion } & Partial<AttachmentDeletion>>(
    "delete_attachment_record",
    { id }
  );
  const data = (value?.data ?? value) as AttachmentDeletion;
  return { ...data, ...toEntityDeletion(value) };
}

/**
 * Converts a structure and writes it where the user chose.
 *
 * The viewer used to build a `Blob` and click a hidden anchor. Inside a Tauri webview that is a
 * download with no dialog, landing wherever the platform decides, and it bypasses the sidecar — so
 * "export as PDB" produced whatever block happened to be stored rather than a converted one. The
 * backend converts and writes, and the path comes from a native save dialog.
 */
export async function exportMoleculeFile(options: {
  inputText: string;
  inputFormat: string;
  outputFormat: string;
  savePath: string;
}) {
  const value = await invokeCommand<{ data?: { path?: string } }>("export_molecule_file", {
    inputText: options.inputText,
    inputFormat: options.inputFormat,
    outputFormat: options.outputFormat,
    savePath: options.savePath
  });
  return { savedPath: value?.data?.path ?? options.savePath };
}

export type { SaveMoleculeWithRequiredDescriptorsPayload };
