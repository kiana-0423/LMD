export type DescriptorStatus = "pending" | "calculated" | "failed" | "mock";
export type DescriptorMode = "real" | "mock";
export type MoleculeCategory =
  | "base_oil_representative"
  | "additive"
  | "solvent"
  | "candidate"
  | "other";

export interface Molecule {
  id: string;
  name: string;
  aliases: string;
  smilesRaw: string;
  smilesCanonical: string;
  inchi: string;
  inchiKey: string;
  formula: string;
  molecularWeight: number;
  category: MoleculeCategory;
  additiveFunctionTags: string[];
  tags?: string[];
  molfile?: string;
  duplicateOf?: string;
  importMode?: string;
  source?: string;
  structureSvgPath: string;
  structureSvg: string;
  molFilePath: string;
  sdfFilePath: string;
  pdbFilePath: string;
  molBlock?: string;
  sdfBlock?: string;
  pdbBlock?: string;
  rdkitDescriptorStatus: DescriptorStatus;
  mordredDescriptorStatus: DescriptorStatus;
  descriptorReady: boolean;
  sourceId: string;
  dataSource: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MoleculeDescriptor {
  id: string;
  moleculeId: string;
  descriptorSet: "rdkit" | "mordred";
  descriptorVersion: string;
  descriptorsJson: Record<string, unknown>;
  descriptorCount: number;
  status: DescriptorStatus;
  mode: DescriptorMode;
  errorMessage: string;
  calculatedAt: string;
}

export interface BaseOil {
  id: string;
  name: string;
  baseOilType: string;
  representativeMoleculeId?: string;
  viscosity40c?: number;
  viscosity100c?: number;
  viscosityIndex?: number;
  density?: number;
  pourPoint?: number;
  flashPoint?: number;
  supplier: string;
  batchNumber: string;
  formulationCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Additive {
  id: string;
  moleculeId: string;
  moleculeName: string;
  functionTypes: string[];
  activeElements: string[];
  typicalConcentrationMin: number;
  typicalConcentrationMax: number;
  concentrationUnit: string;
  compatibleBaseOils: string[];
  formulationCount: number;
  bestFrictionCoefficient?: number;
  bestWearScarDiameter?: number;
  applicationNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Formulation {
  id: string;
  name: string;
  baseOil: string;
  additiveCount: number;
  componentsSummary: string;
  preparationMethod: string;
  preparationTemperature?: number;
  preparationTemperatureUnit?: string;
  preparationTime?: number;
  preparationTimeUnit?: string;
  stabilityObservation: string;
  experimentCount: number;
  bestAverageFrictionCoefficient?: number;
  bestWearScarDiameter?: number;
  highestOxidationTemperature?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormulationComponent {
  id: string;
  formulationId: string;
  componentRole: "base_oil" | "additive" | "solvent" | "other";
  moleculeId?: string;
  baseOilId?: string;
  additiveId?: string;
  concentrationValue: number;
  concentrationUnit: string;
  concentrationStandardValue?: number;
  concentrationStandardUnit?: string;
  notes: string;
}

export interface Experiment {
  id: string;
  formulationId: string;
  formulationName: string;
  testType: string;
  testStandard: string;
  instrument: string;
  upperMaterial: string;
  lowerMaterial: string;
  loadValue?: number;
  loadUnit?: string;
  temperatureValue?: number;
  temperatureUnit?: string;
  durationValue?: number;
  durationUnit?: string;
  operator: string;
  experimentDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceResult {
  id: string;
  experimentId: string;
  averageFrictionCoefficient?: number;
  stableFrictionCoefficient?: number;
  wearScarWidthValue?: number;
  wearScarDiameterValue?: number;
  initialOxidationTemperatureValue?: number;
  extremePressureValue?: number;
  pbValue?: number;
  pdValue?: number;
  viscosity40c?: number;
  viscosity100c?: number;
  repeatCount?: number;
  stdJson?: Record<string, unknown>;
  rawResultJson?: Record<string, unknown>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  linkedEntityType: string;
  linkedEntityId: string;
  fileName: string;
  fileType: string;
  relativePath: string;
  description: string;
  uploadedAt: string;
}

export interface Job {
  id: string;
  jobType: string;
  status: string;
  progress: number;
  totalCount: number;
  successCount: number;
  failedCount: number;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: string;
  sourceType: string;
  title: string;
  authors: string;
  journal: string;
  year?: number;
  doi: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  moleculeCount: number;
  baseOilCount: number;
  additiveCount: number;
  formulationCount: number;
  formulationComponentCount?: number;
  experimentCount: number;
  performanceResultCount?: number;
  attachmentCount?: number;
  dataSourceCount?: number;
  jobCount?: number;
  runningJobCount?: number;
  failedJobCount?: number;
  descriptorRecordCount?: number;
  descriptorReadyCount: number;
  descriptorFailedCount: number;
  descriptorPendingCount?: number;
  descriptorMockCount?: number;
  descriptorRealCount?: number;
}

export interface DescriptorExportOptions {
  includeRdkit: boolean;
  includeMordred: boolean;
  includeMetadata: boolean;
}

export interface MLDescriptorMatrixOptions extends DescriptorExportOptions {
  numericOnly: boolean;
  missingValueStrategy: "blank" | "null" | "zero";
  descriptorPrefix: boolean;
}

export interface SketcherValidationResult {
  valid: boolean;
  error?: string;
  smilesRaw?: string;
  smilesCanonical?: string;
  canonicalSmiles?: string;
  formula?: string;
  molecularWeight?: number;
  inchiKey?: string;
  inchikey?: string;
}

export interface SketcherDescriptorResult {
  valid: boolean;
  descriptorCount: number;
  descriptors: Record<string, unknown>;
  preview: Record<string, unknown>;
  rdkitStatus?: DescriptorStatus;
  mordredStatus?: DescriptorStatus;
  error?: string;
}

export interface MoleculeDuplicateResult {
  duplicate: boolean;
  existingMoleculeId?: string;
  matchedBy?: "canonical_smiles" | "inchikey" | "both";
}

export interface ImportNewMoleculePayload {
  name: string;
  category: MoleculeCategory;
  tags: string[];
  originalSmiles: string;
  canonicalSmiles: string;
  molfile: string;
  formula: string;
  molecularWeight: number;
  inchikey: string;
  descriptorJson: Record<string, unknown>;
  duplicateOf?: string;
  importMode: "manual_save" | "new_import" | "new_copy" | "library_update";
  source: "ketcher" | "smiles_input" | "molfile_input" | "library_edit";
}

export interface ImportNewMoleculeResult {
  success: boolean;
  moleculeId?: string;
  duplicate?: boolean;
  duplicateOf?: string;
  error?: string;
}
