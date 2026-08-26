import type {
  ImportNewMoleculePayload,
  ImportNewMoleculeResult,
  ImportNewMoleculeRaw,
  MoleculeDuplicateResult,
  MoleculeDuplicateRaw,
  SketcherDescriptorResult,
  SketcherValidationResult,
  SidecarResponse,
  SidecarSketcherDescriptorsRaw,
  SidecarSmilesToMolfileRaw,
  SidecarValidationRaw
} from "../types";
import { invokeCommand } from "./tauri";

function unwrapData<T>(value: SidecarResponse<T>): T {
  return (value.data ?? value) as T;
}

function camelValidation(data: SidecarValidationRaw): SketcherValidationResult {
  return {
    valid: Boolean(data.valid),
    error: String(data.error ?? ""),
    smilesRaw: data.smiles_raw ?? "",
    smilesCanonical: data.smiles_canonical ?? data.canonical_smiles ?? "",
    canonicalSmiles: data.canonical_smiles ?? data.smiles_canonical ?? "",
    formula: data.formula ?? "",
    molecularWeight: data.molecular_weight ?? 0,
    inchiKey: data.inchi_key ?? data.inchikey ?? "",
    inchikey: data.inchi_key ?? data.inchikey ?? ""
  };
}

export async function validateSketcherSmiles(smiles: string) {
  return invokeCommand<SidecarResponse<SidecarValidationRaw>>(
    "validate_smiles_with_sidecar",
    { smiles }).then((value) => camelValidation(unwrapData(value)));
}

export async function molfileToSmiles(molfile: string) {
  return invokeCommand<SidecarResponse<SidecarValidationRaw>>(
    "molfile_to_smiles_with_sidecar",
    { molfile }).then((value) => camelValidation(unwrapData(value)));
}

export async function smilesToMolfile(smiles: string) {
  return invokeCommand<SidecarResponse<SidecarSmilesToMolfileRaw>>(
    "smiles_to_molfile_with_sidecar",
    { smiles }).then((value) => unwrapData(value));
}

export async function calculateSketcherDescriptors(smiles: string): Promise<SketcherDescriptorResult> {
  const value = await invokeCommand<SidecarResponse<SidecarSketcherDescriptorsRaw>>(
    "calculate_sketcher_descriptors_with_sidecar",
    { smiles });
  const data = unwrapData(value);
  return {
    valid: Boolean(data.valid),
    descriptorCount: data.descriptor_count ?? 0,
    descriptors: { ...(data.descriptors ?? {}) },
    preview: data.preview ?? {},
    rdkitStatus: data.rdkit_status ?? "mock",
    mordredStatus: data.mordred_status ?? "mock",
    error: data.error ?? ""
  };
}

export async function checkMoleculeDuplicate(canonicalSmiles: string, inchikey?: string): Promise<MoleculeDuplicateResult> {
  const value = await invokeCommand<MoleculeDuplicateRaw>(
    "check_molecule_duplicate",
    { payload: { canonicalSmiles, inchikey } });
  return {
    duplicate: Boolean(value.duplicate),
    existingMoleculeId: value.existing_molecule_id ?? "",
    matchedBy: value.matched_by
  };
}

export async function importNewMolecule(payload: ImportNewMoleculePayload): Promise<ImportNewMoleculeResult> {
  if (!payload.canonicalSmiles?.trim()) {
    return {
      success: false,
      moleculeId: "",
      duplicate: false,
      duplicateOf: "",
      error: "SMILES is required. Please generate a valid canonical SMILES first."
    };
  }
  const value = await invokeCommand<ImportNewMoleculeRaw>(
    "import_new_molecule",
    { payload });
  return {
    success: Boolean(value.success),
    moleculeId: value.molecule_id ?? "",
    duplicate: Boolean(value.duplicate),
    duplicateOf: value.duplicate_of ?? "",
    error: value.error ?? ""
  };
}
