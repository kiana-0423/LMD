import { vi } from "vitest";

/**
 * A stand-in for `src/lib/api` that answers every export with the shape its callers expect.
 *
 * A partial mock is worse than no mock: a component that calls a function the mock forgot gets
 * `undefined`, awaits it, and reads a property off it — which surfaces as an unhandled rejection
 * long after the test that caused it has "passed". That is exactly how `MoleculePicker` began
 * failing the suite while every assertion still reported green.
 *
 * So the defaults below are exhaustive by construction: `api-mock-contract.test.ts` compares these
 * keys against the real module's exports and fails when they drift apart.
 */

const emptyPage = { items: [], total: 0, page: 1, pageSize: 50 };
const emptyExport = { path: "", fileName: "", bytes: 0, rowCount: 0, content: "" };
const emptyAnalysis = {
  status: "insufficient_data" as const,
  message: "",
  metadata: { recordCount: 0, excludedCount: 0, field: "", unit: "", method: "", missingValueHandling: "" },
  series: [],
  warnings: []
};
const emptyDeletion = { success: true, deleted: true, cleanupFailures: [] };
/** A catalogue delete that was allowed: nothing referenced the record. */
const emptyOutcome = {
  id: "",
  deleted: true,
  success: true,
  blocked: false,
  blockedBy: [],
  removedComponents: 0,
  cleanupFailures: []
};
const emptyEntityPage = { items: [], total: 0, page: 1, pageSize: 50, hasMore: false };
const emptyPrediction = {
  modelId: "",
  modelName: "",
  target: "",
  algorithm: "",
  trainedAt: "",
  sampleCount: 0,
  datasetMode: "additive_component" as const,
  concentrationBasis: "wt%",
  metrics: {},
  predictions: [],
  skipped: []
};

/** One default per export of `src/lib/api`, keyed by name. */
export const API_MOCK_DEFAULTS: Record<string, () => unknown> = {
  // --- molecules -----------------------------------------------------------------------------
  listMoleculePage: () => Promise.resolve(emptyPage),
  listMolecules: () => Promise.resolve([]),
  getMolecule: () => Promise.resolve(undefined),
  deleteMolecule: () => Promise.resolve(emptyDeletion),
  saveMoleculeWithRequiredDescriptors: () => Promise.resolve(undefined),
  generateMolecule3d: () =>
    Promise.resolve({
      molecule: undefined,
      molFilePath: "",
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 0,
      replacedVersions: 0,
      cleanupFailures: [],
      mode: "real"
    }),
  listFormulationsForMolecule: () => Promise.resolve([]),
  listMoleculeFiles: () => Promise.resolve({ structureFiles: [], attachments: [] }),
  importAttachment: () => Promise.resolve({}),
  exportMoleculeFile: () => Promise.resolve({ savedPath: "" }),
  exportWorkspaceFile: () => Promise.resolve({}),
  deleteAttachmentRecord: () =>
    Promise.resolve({ ...emptyDeletion, id: "", fileName: "", removedFiles: 0 }),

  // --- descriptors ---------------------------------------------------------------------------
  listMoleculeDescriptors: () => Promise.resolve([]),
  listDescriptorsForMolecules: () => Promise.resolve([]),
  listDescriptorJobs: () => Promise.resolve([]),
  calculateDescriptorsForMolecules: () => Promise.resolve({}),
  recalculateAllDescriptors: () => Promise.resolve({}),
  recalculateFailedDescriptors: () => Promise.resolve({}),

  // --- base oils and additives ---------------------------------------------------------------
  listBaseOils: () => Promise.resolve([]),
  listAdditives: () => Promise.resolve([]),
  createBaseOil: () => Promise.resolve({}),
  createAdditive: () => Promise.resolve({}),
  updateBaseOil: () => Promise.resolve({}),
  updateAdditive: () => Promise.resolve({}),
  deleteBaseOil: () => Promise.resolve(emptyOutcome),
  deleteAdditive: () => Promise.resolve(emptyOutcome),
  deleteBaseOilWithComponents: () => Promise.resolve(emptyOutcome),
  deleteAdditiveWithComponents: () => Promise.resolve(emptyOutcome),
  listBaseOilPage: () => Promise.resolve(emptyEntityPage),
  listAdditivePage: () => Promise.resolve(emptyEntityPage),
  searchBaseOils: () => Promise.resolve([]),
  searchAdditives: () => Promise.resolve([]),

  // --- formulations and experiments ----------------------------------------------------------
  listFormulations: () => Promise.resolve([]),
  listFormulationPage: () => Promise.resolve(emptyEntityPage),
  searchFormulations: () => Promise.resolve([]),
  createFormulation: () => Promise.resolve({}),
  updateFormulation: () => Promise.resolve({}),
  copyFormulation: () => Promise.resolve({}),
  compareFormulations: () => Promise.resolve([]),
  deleteFormulation: () => Promise.resolve(emptyDeletion),
  listExperiments: () => Promise.resolve([]),
  listExperimentPage: () => Promise.resolve(emptyEntityPage),
  listPerformanceResults: () => Promise.resolve([]),
  listPerformanceResultPage: () => Promise.resolve(emptyEntityPage),
  getExperimentWithResults: () => Promise.resolve({ experiment: undefined, experiments: [], results: [] }),
  listFormulationExperiments: () => Promise.resolve({ experiments: [], results: [] }),
  saveExperimentWithPerformance: () => Promise.resolve({ experiment: {}, result: {} }),
  updateExperimentRecord: () => Promise.resolve({}),
  deleteExperimentRecord: () => Promise.resolve(emptyDeletion),
  updatePerformanceResultRecord: () => Promise.resolve({}),
  deletePerformanceResultRecord: () => Promise.resolve(emptyDeletion),
  listAttachments: () => Promise.resolve([]),

  // --- analysis ------------------------------------------------------------------------------
  getDashboardSummary: () => Promise.resolve({}),
  listPerformanceMetrics: () => Promise.resolve([]),
  getPerformanceDistribution: () => Promise.resolve(emptyAnalysis),
  comparePerformanceByGroup: () => Promise.resolve(emptyAnalysis),
  getConcentrationPerformance: () => Promise.resolve(emptyAnalysis),
  getDescriptorPropertyCorrelation: () => Promise.resolve(emptyAnalysis),

  // --- models --------------------------------------------------------------------------------
  listModels: () => Promise.resolve([]),
  listModelJobs: () => Promise.resolve([]),
  trainModel: () => Promise.resolve({}),
  predictMoleculePerformance: () => Promise.resolve(emptyPrediction),
  predictFormulationPerformance: () => Promise.resolve(emptyPrediction),
  exportMlDataset: () => Promise.resolve(emptyExport),
  describeTrainingScope: () =>
    Promise.resolve({
      target: "",
      label: "",
      unit: "",
      resultCount: 0,
      singleAdditiveResultCount: 0,
      multiAdditiveResultCount: 0,
      resultsWithConditions: 0,
      moleculeCount: 0,
      testTypes: []
    }),

  // --- molecular design ----------------------------------------------------------------------
  listDesignTemplates: () =>
    Promise.resolve({
      templates: [],
      curatedSubstituents: [],
      substituentSources: [],
      limits: { maxCandidates: 500, maxSeeds: 25, maxSubstituents: 200 },
      generatorVersion: ""
    }),
  getDesignReadiness: () =>
    Promise.resolve({
      target: "",
      workspace: { moleculeCount: 0, moleculesWithRealDescriptors: 0, performanceResultCount: 0, candidateCount: 0 },
      models: [],
      dataset: null,
      status: "generationOnly",
      reasons: []
    }),
  runDesignGeneration: () => Promise.resolve({ jobId: "", candidateCount: 0, candidates: [], warnings: [] }),
  listDesignCandidates: () => Promise.resolve(emptyPage),
  listDesignJobs: () => Promise.resolve([]),
  assessDesignCandidates: () =>
    Promise.resolve({ jobId: "", modelId: "", items: [], counts: { supported: 0, exploratory: 0, unavailable: 0 }, warnings: [] }),
  promoteDesignCandidate: () => Promise.resolve({ candidate: undefined, moleculeId: "", moleculeName: "" }),
  updateDesignCandidateVerification: () => Promise.resolve({ candidate: undefined }),
  exportDesignCandidates: () => Promise.resolve(emptyExport),

  // --- workspace -----------------------------------------------------------------------------
  getWorkspaceDetails: () => Promise.resolve({}),
  checkDatabaseIntegrity: () => Promise.resolve({}),
  listWorkspaceBackups: () => Promise.resolve([]),
  createWorkspaceBackup: () => Promise.resolve({}),
  restoreWorkspaceBackup: () => Promise.resolve({}),
  listRowsNeedingAttention: () => Promise.resolve([]),
  createWorkspace: () => Promise.resolve({}),
  openWorkspace: () => Promise.resolve({}),
  getDiagnostics: () => Promise.resolve({}),
  exportDiagnostics: () => Promise.resolve({}),

  // --- import and export ---------------------------------------------------------------------
  previewTableImport: () => Promise.resolve({}),
  confirmTableImport: () => Promise.resolve({}),
  exportAllDescriptorsCsv: () => Promise.resolve(emptyExport),
  exportMlDescriptorMatrixCsv: () => Promise.resolve(emptyExport),
  exportMoleculeLibraryCsv: () => Promise.resolve(emptyExport),
  // Synchronous helpers: these return a value, not a promise.
  unwrapExport: () => Promise.resolve(emptyExport),
  deliverExport: () => undefined,
  describeExport: () => ""
};

/**
 * Builds a complete mock of `src/lib/api`, with the given overrides applied on top.
 *
 * Every export is a `vi.fn`, so a test can assert on calls without having to name the function in
 * advance.
 */
export function createApiMock(overrides: Record<string, unknown> = {}) {
  const mock: Record<string, unknown> = {};
  for (const [name, produce] of Object.entries(API_MOCK_DEFAULTS)) {
    mock[name] = vi.fn(() => produce());
  }
  return { ...mock, ...overrides };
}
