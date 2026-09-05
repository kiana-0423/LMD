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

export interface MoleculeListFilter {
  search?: string;
  category?: string;
  source?: string;
  importMode?: string;
  duplicateStatus?: "original" | "duplicate";
  element?: string;
  page?: number;
  pageSize?: number;
}

export interface MoleculePage {
  items: Molecule[];
  total: number;
  page: number;
  pageSize: number;
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
  components?: FormulationComponent[];
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
  bestExtremePressureValue?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormulationComponent {
  moleculeName?: string;
  baseOilName?: string;
  additiveName?: string;
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

export type SidecarResponse<T> = { data?: T } & T;

export interface SidecarValidationRaw {
  valid: boolean;
  error?: string;
  smiles_raw?: string;
  smiles_canonical?: string;
  canonical_smiles?: string;
  formula?: string;
  molecular_weight?: number;
  inchi_key?: string;
  inchikey?: string;
}

export interface SidecarStandardizeRaw {
  smiles_raw: string;
  smiles_canonical: string;
  inchi: string;
  inchi_key: string;
  formula: string;
  molecular_weight: number;
  mode?: DescriptorMode | "mock";
}

export interface SidecarSmilesToMolfileRaw {
  valid: boolean;
  error?: string;
  molfile: string;
  canonical_smiles?: string;
}

export interface SidecarGenerate3dRaw {
  mol_block: string;
  sdf_block: string;
  pdb_block: string;
  mode?: DescriptorMode | "mock";
}

export interface SidecarDescriptorSetRaw {
  descriptor_set?: "rdkit" | "mordred";
  descriptor_version?: string;
  descriptor_count?: number;
  mode?: DescriptorMode;
  descriptors: Record<string, unknown>;
}

export interface SidecarSketcherDescriptorsRaw {
  valid: boolean;
  descriptor_count: number;
  descriptors: {
    rdkit?: SidecarDescriptorSetRaw;
    mordred?: SidecarDescriptorSetRaw;
  };
  preview: Record<string, unknown>;
  rdkit_status?: DescriptorStatus;
  mordred_status?: DescriptorStatus;
  error?: string;
}

export interface SidecarRequiredDescriptorsRaw extends SidecarStandardizeRaw {
  rdkit?: SidecarDescriptorSetRaw;
  mordred?: SidecarDescriptorSetRaw;
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

export interface MoleculeDuplicateRaw {
  duplicate: boolean;
  existing_molecule_id?: string;
  molecule_id?: string;
  matched_by?: "canonical_smiles" | "inchikey" | "both";
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
  notes?: string;
}

export interface ImportNewMoleculeResult {
  success: boolean;
  moleculeId?: string;
  duplicate?: boolean;
  duplicateOf?: string;
  error?: string;
}

export interface ImportNewMoleculeRaw {
  success: boolean;
  molecule_id?: string;
  duplicate?: boolean;
  duplicate_of?: string;
  error?: string;
}

export interface ImportPreviewResult {
  file_path: string;
  sheet_names: string[];
  columns: string[];
  rows: Array<Record<string, unknown>>;
  preview_rows: Array<Record<string, unknown>>;
  imported_count: number;
  skipped_count?: number;
  created_molecule_count?: number;
  import_kind?: "base_oils" | "additives" | "preview_only";
  warnings?: string[];
}

/** Either a file Rust already wrote, or CSV text for the browser to download. */
export interface ExportResult {
  savedPath?: string;
  rowCount?: number;
  columnCount?: number;
  content?: string;
  fileName?: string;
}

/** A formulation that uses a molecule, with the measured summary of its experiments. */
export interface FormulationUsage {
  formulationId: string;
  formulationName: string;
  role: "component" | "additive" | "base_oil";
  /** Every recorded concentration, one per component. */
  concentrations: { componentId: string; value: number | null; unit: string }[];
  /** Set only when every entry shares a unit, so a total is meaningful. */
  totalConcentration: number | null;
  concentrationUnit: string;
  componentCount: number;
  experimentCount: number;
  bestAverageFrictionCoefficient: number | null;
  bestWearScarDiameter: number | null;
  highestOxidationTemperature: number | null;
  bestExtremePressureValue: number | null;
}

export interface WorkspaceFile {
  kind: string;
  relativePath: string;
  exists: boolean;
  bytes: number;
}

export interface AttachmentRecord {
  id: string;
  fileName: string;
  fileType: string;
  relativePath: string;
  description: string;
  uploadedAt: string;
  exists: boolean;
  bytes: number;
}

export interface MoleculeFiles {
  structureFiles: WorkspaceFile[];
  attachments: AttachmentRecord[];
}

/**
 * What deleting a record reports back, for every entity that owns files.
 *
 * `cleanupFailures` is not an error: the row is gone regardless. It names files the backend could
 * not remove from disk — refused by the filesystem, already missing, or stored under a path that
 * cannot be resolved safely — so the interface can say "deleted, but…" instead of an unqualified
 * success.
 */
/** One bounded page of records, as every paginated command returns it. */
export interface EntityPage<T> {
  items: T[];
  /** How many records match the filter in total, not how many are on this page. */
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** One row of a selector: the id a payload needs and the words a person reads. */
export interface EntityOption {
  id: string;
  label: string;
  /** A short qualifier — a base oil's type, an additive's function — or an empty string. */
  detail: string;
}

/** A formulation that references a record somebody is trying to delete. */
export interface AffectedFormulation {
  formulationId: string;
  formulationName: string;
  /** How many of its components point at the record. */
  componentCount: number;
  componentRoles: string[];
}

/**
 * What deleting a catalogued base oil or additive did — or refused to do.
 *
 * `blocked` is the case that matters: the record is still there, nothing was changed, and
 * `blockedBy` says what is in the way. The previous behaviour deleted the referencing components
 * silently, which left blends describing mixtures that cannot exist.
 */
export interface DeletionOutcome {
  id: string;
  deleted: boolean;
  success: boolean;
  blocked: boolean;
  blockedBy: AffectedFormulation[];
  /** How many formulation components an explicit cascade removed. Zero otherwise. */
  removedComponents: number;
  cleanupFailures: string[];
}

export interface EntityDeletion {
  success: boolean;
  deleted: boolean;
  cleanupFailures: string[];
}

/**
 * What deleting one attachment reports back.
 *
 * `cleanupFailures` is not an error: the row is gone regardless. It names files the backend could
 * not remove from disk, so the interface can say "deleted, but…" instead of an unqualified
 * success.
 */
export interface AttachmentDeletion extends EntityDeletion {
  id: string;
  fileName: string;
  linkedEntityType: string;
  linkedEntityId: string;
  relativePath: string;
  removedFiles: number;
}

/** What `generate_molecule_3d` returns once the structure has been stored. */
export interface Generated3dResult {
  molecule: Molecule;
  molFilePath: string;
  sdfFilePath: string;
  pdbFilePath: string;
  atomCount: number;
  /** Superseded structure files that were removed once the new ones were recorded. */
  replacedVersions: number;
  /** Superseded files that could not be removed. The stored structure is still correct. */
  cleanupFailures: string[];
  mode: string;
}

/** A recorded descriptor batch or recalculation run. */
export interface DescriptorJob {
  id: string;
  jobType: string;
  /** `partial` means some items succeeded and some failed; `interrupted` means the application
   *  closed while the job was running. */
  status: "running" | "succeeded" | "partial" | "failed" | "interrupted";
  progress: number;
  totalCount: number;
  successCount: number;
  failedCount: number;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}


// --- Workspace, backups and diagnostics --------------------------------------------------------

/** Where a workspace lives and what state it is in. */
export interface WorkspaceDetails {
  workspacePath: string;
  databasePath: string;
  databaseExists: boolean;
  databaseSizeBytes: number;
  schemaVersion: number;
  /** The version this build writes; a workspace behind it is migrated when opened. */
  supportedSchemaVersion: number;
  backupCount: number;
  automaticBackupLimit: number;
  latestBackup?: BackupRecord;
  /** Legacy rows a current rule would reject, preserved rather than corrected. */
  rowsNeedingAttention: number;
}

/** One file in the workspace's backups folder. */
export interface BackupRecord {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  /** True when the application took it — before a migration, for instance. */
  automatic: boolean;
}

/** What SQLite's own checks said about a database file. */
export interface IntegrityReport {
  ok: boolean;
  /** SQLite's answer verbatim: `ok`, or a description of what is wrong. */
  integrity: string;
  foreignKeyViolations: number;
  schemaVersion: number;
  dataQualityIssues: number;
}

/** What a restore did, and what it preserved on the way. */
export interface RestoreOutcome {
  restoredFrom: string;
  /** The backup taken of the database that was replaced, so the restore is itself reversible. */
  previousDatabaseBackup: string;
  report: IntegrityReport;
}

/** One legacy row a current rule would reject. */
export interface DataQualityRow {
  tableName: string;
  rowId: string;
  rule: string;
  detail: string;
}

/** Where a diagnostics report was written. */
export interface DiagnosticsExport {
  path: string;
  /** The same path with the home directory replaced by `~`, for showing on screen. */
  displayPath: string;
  bytes: number;
}

// --- Two-stage table import --------------------------------------------------------------------

/** What the preview stage found. Nothing has been written when this is returned. */
export interface ImportPreview {
  filePath: string;
  fileName: string;
  /** `base_oils`, `additives`, or `preview_only` when nothing recognisable was found. */
  detectedKind: string;
  columns: string[];
  previewRows: Record<string, unknown>[];
  sheetNames: string[];
  /** False when confirming would import nothing. */
  importable: boolean;
  warnings: string[];
  /** Identifies the exact bytes that were previewed, so a changed file is refused. */
  fingerprint: string;
}

/** One row that was read but not stored, and why. */
export interface RejectedRow {
  row: number;
  reason: string;
}

/** What the confirmed import actually did. */
export interface ImportOutcome {
  importKind: string;
  importedCount: number;
  skippedCount: number;
  createdMoleculeCount: number;
  rejected: RejectedRow[];
  warnings: string[];
}

/** What the diagnostics report contains. Versions, paths, counts — never scientific data. */
export interface DiagnosticsReport {
  generatedAt: string;
  applicationVersion: string;
  platform: string;
  architecture: string;
  /** Absolute paths with the home directory replaced by `~`. */
  workspacePath: string;
  workspaceExists: boolean;
  databasePath: string;
  databaseExists: boolean;
  databaseSizeBytes: number;
  schemaVersion: number;
  supportedSchemaVersion: number;
  rowsNeedingAttention: number;
  /** Row counts per table. Counts, never contents. */
  recordCounts: Record<string, number>;
  /** The sidecar's own health answer, including every dependency version. */
  sidecar: Record<string, unknown>;
  recentLog: string[];
  collectionErrors: string[];
}
