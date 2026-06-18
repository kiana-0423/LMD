import type {
  ImportNewMoleculePayload,
  ImportNewMoleculeResult,
  MoleculeDuplicateResult,
  SketcherDescriptorResult,
  SketcherValidationResult
} from "../types";
import { mockSvg, moleculeDescriptors, molecules } from "./mockData";
import { buildMock3dMolBlock, buildMockPdbBlock, buildMockSdfBlock } from "./mockStructure";
import { invokeOrMock } from "./tauri";

type SidecarResponse<T> = { data?: T } & T;

function unwrapData<T>(value: SidecarResponse<T>): T {
  return (value.data ?? value) as T;
}

function camelValidation(data: Record<string, unknown>): SketcherValidationResult {
  return {
    valid: Boolean(data.valid),
    error: String(data.error ?? ""),
    smilesRaw: String(data.smiles_raw ?? ""),
    smilesCanonical: String(data.smiles_canonical ?? data.canonical_smiles ?? ""),
    canonicalSmiles: String(data.canonical_smiles ?? data.smiles_canonical ?? ""),
    formula: String(data.formula ?? ""),
    molecularWeight: Number(data.molecular_weight ?? 0),
    inchiKey: String(data.inchi_key ?? data.inchikey ?? ""),
    inchikey: String(data.inchi_key ?? data.inchikey ?? "")
  };
}

export async function validateSketcherSmiles(smiles: string) {
  return invokeOrMock<SidecarResponse<Record<string, unknown>>>(
    "validate_smiles_with_sidecar",
    { smiles },
    async () => ({
      valid: Boolean(smiles.trim()),
      canonical_smiles: smiles.trim(),
      smiles_canonical: smiles.trim(),
      formula: smiles.includes("O") ? "C2H6O" : "C1H2",
      molecular_weight: smiles.length * 7.1 + 18,
      inchi_key: `MOCK-${Math.abs(hash(smiles))}`
    })
  ).then((value) => camelValidation(unwrapData(value)));
}

export async function molfileToSmiles(molfile: string) {
  return invokeOrMock<SidecarResponse<Record<string, unknown>>>(
    "molfile_to_smiles_with_sidecar",
    { molfile },
    async () => ({
      valid: Boolean(molfile.trim()),
      canonical_smiles: molfile.includes("CCO") ? "CCO" : "",
      formula: molfile.includes("CCO") ? "C2H6O" : "",
      molecular_weight: molfile.includes("CCO") ? 46.069 : 0,
      inchi_key: molfile.includes("CCO") ? "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" : ""
    })
  ).then((value) => camelValidation(unwrapData(value)));
}

export async function smilesToMolfile(smiles: string) {
  return invokeOrMock<SidecarResponse<Record<string, unknown>>>(
    "smiles_to_molfile_with_sidecar",
    { smiles },
    async () => ({
      valid: Boolean(smiles.trim()),
      molfile: buildMock3dMolBlock(smiles, smiles.trim() || "LMD"),
      canonical_smiles: smiles.trim()
    })
  ).then((value) => unwrapData(value));
}

export async function calculateSketcherDescriptors(smiles: string): Promise<SketcherDescriptorResult> {
  const value = await invokeOrMock<SidecarResponse<Record<string, unknown>>>(
    "calculate_sketcher_descriptors_with_sidecar",
    { smiles, allowMock: true },
    async () => ({
      valid: true,
      descriptor_count: 8,
      descriptors: {
        rdkit: { descriptors: { MolWt: 46.069, MolLogP: -0.001, TPSA: 20.23, NumHDonors: 1, NumHAcceptors: 1 } },
        mordred: { descriptors: { ABC: 1.414, nAtom: 9 } }
      },
      preview: { MolWt: 46.069, LogP: -0.001, TPSA: 20.23, HBD: 1, HBA: 1, RotatableBonds: 0 },
      rdkit_status: "mock",
      mordred_status: "mock"
    })
  );
  const data = unwrapData(value) as Record<string, unknown>;
  return {
    valid: Boolean(data.valid),
    descriptorCount: Number(data.descriptor_count ?? 0),
    descriptors: (data.descriptors as Record<string, unknown>) ?? {},
    preview: (data.preview as Record<string, unknown>) ?? {},
    rdkitStatus: String(data.rdkit_status ?? "mock") as SketcherDescriptorResult["rdkitStatus"],
    mordredStatus: String(data.mordred_status ?? "mock") as SketcherDescriptorResult["mordredStatus"],
    error: String(data.error ?? "")
  };
}

export async function checkMoleculeDuplicate(canonicalSmiles: string, inchikey?: string): Promise<MoleculeDuplicateResult> {
  const value = await invokeOrMock<Record<string, unknown>>(
    "check_molecule_duplicate",
    { payload: { canonicalSmiles, inchikey } },
    async () => {
      const existing = molecules.find((item) => item.smilesCanonical === canonicalSmiles || (inchikey && item.inchiKey === inchikey));
      return existing
        ? { duplicate: true, existing_molecule_id: existing.id, matched_by: "canonical_smiles" }
        : { duplicate: false };
    }
  );
  return {
    duplicate: Boolean(value.duplicate),
    existingMoleculeId: String(value.existing_molecule_id ?? ""),
    matchedBy: value.matched_by as MoleculeDuplicateResult["matchedBy"]
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
  const value = await invokeOrMock<Record<string, unknown>>(
    "import_new_molecule",
    { payload },
    async () => {
      const id = `mol-${Date.now()}`;
      const molBlock = buildMock3dMolBlock(payload.canonicalSmiles, payload.name || payload.canonicalSmiles);
      molecules.unshift({
        id,
        name: payload.name,
        aliases: "",
        smilesRaw: payload.originalSmiles,
        smilesCanonical: payload.canonicalSmiles,
        inchi: "",
        inchiKey: payload.inchikey,
        formula: payload.formula,
        molecularWeight: payload.molecularWeight,
        category: payload.category,
        additiveFunctionTags: payload.tags,
        tags: payload.tags,
        molfile: payload.molfile || molBlock,
        duplicateOf: payload.duplicateOf,
        importMode: payload.importMode,
        source: payload.source,
        structureSvgPath: `files/structures/${id}.svg`,
        structureSvg: mockSvg(payload.name || payload.formula || payload.canonicalSmiles),
        molFilePath: `files/structures/${id}.mol`,
        sdfFilePath: `files/structures/${id}.sdf`,
        pdbFilePath: `files/structures/${id}.pdb`,
        molBlock,
        sdfBlock: buildMockSdfBlock(molBlock),
        pdbBlock: buildMockPdbBlock(payload.canonicalSmiles, payload.name || "MOCK MOLECULE"),
        rdkitDescriptorStatus: "mock",
        mordredDescriptorStatus: "mock",
        descriptorReady: true,
        sourceId: payload.source,
        dataSource: payload.source,
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      moleculeDescriptors.push({
        id: `${id}-sketcher`,
        moleculeId: id,
        descriptorSet: "rdkit",
        descriptorVersion: "sketcher-mock",
        descriptorsJson: payload.descriptorJson,
        descriptorCount: Object.keys(payload.descriptorJson).length,
        status: "mock",
        mode: "mock",
        errorMessage: "",
        calculatedAt: new Date().toISOString()
      });
      return { success: true, molecule_id: id, duplicate: Boolean(payload.duplicateOf), duplicate_of: payload.duplicateOf };
    }
  );
  return {
    success: Boolean(value.success),
    moleculeId: String(value.molecule_id ?? ""),
    duplicate: Boolean(value.duplicate),
    duplicateOf: String(value.duplicate_of ?? ""),
    error: String(value.error ?? "")
  };
}

function hash(value: string) {
  return value.split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 0);
}
