import type { ExportResult } from "../../types";
import { invokeCommand, isTauriRuntime } from "../tauri";
import { unwrapExport } from "./export";
import { coded } from "../backendErrors";
import type { BackendMessage } from "../backendMessages";
import type { DatasetScope, TrainedModel } from "./model";

/**
 * Molecular design: optional-template generation, a persistent candidate collection, and
 * prediction with the evidence needed to judge it.
 *
 * Every function here needs the desktop application: generation and assessment run in the
 * packaged sidecar and the candidate collection lives in the workspace database. The browser
 * demo does not implement any of them, and refuses rather than inventing a candidate.
 */

// --- Templates and requests ---------------------------------------------------------------------

export type DesignTemplate = {
  id: string;
  family: string;
  label: string;
  formulaSketch: string;
  degree: number;
  positions: number[];
  chemicalClasses: string[];
  description: string;
  generatorVersion: string;
};

export type CuratedSubstituent = { id: string; name: string; smiles: string };

export type DesignTemplateCatalogue = {
  templates: DesignTemplate[];
  curatedSubstituents: CuratedSubstituent[];
  substituentSources: string[];
  limits: { maxCandidates: number; maxSeeds: number; maxSubstituents: number };
  generatorVersion: string;
};

export type SubstituentConstraints = {
  permittedElements: string[];
  allowedTypes: string[];
  minHeavyAtoms: number;
  maxHeavyAtoms: number;
  maxBranchPoints: number;
};

export type SeedRequest = { source: "library" | "user"; moleculeId?: string; smiles?: string; label?: string };

export type CandidateConstraints = Omit<SubstituentConstraints, "allowedTypes">;

/** The application context a design request is made for. Every field is recorded as given. */
export type ApplicationContext = {
  baseOilId?: string;
  baseOilName?: string;
  concentration?: number;
  concentrationUnit?: string;
  otherComponents?: string;
  testType?: string;
  temperatureValue?: number;
  temperatureUnit?: string;
  loadValue?: number;
  loadUnit?: string;
  notes?: string;
};

export type DesignRequest = {
  name?: string;
  // Chemical class.
  templateId?: string;
  constraints: SubstituentConstraints;
  candidateConstraints?: CandidateConstraints;
  substituentSources: string[];
  curatedSubstituentIds?: string[] | null;
  identicalSubstituents?: boolean;
  maxCandidates: number;
  randomSeed?: number | null;
  seeds: SeedRequest[];
  // Target function / property: recorded as intent, never as a property of a structure.
  targetFunction?: string;
  targetMetric?: string;
  // Application conditions.
  context: ApplicationContext;
};

// --- Candidates ---------------------------------------------------------------------------------

export type ValidationFinding = { rule: string; ok: boolean; detail: string };

export type CandidateSubstituent = {
  position: number;
  smiles: string;
  name: string;
  type: string;
  heavyAtoms?: number;
  heavy_atoms?: number;
  branchPoints?: number;
  branch_points?: number;
  elements: string[];
  source: string;
  sourceId?: string;
  source_id?: string;
};

export type LatestAssessment = {
  status: AssessmentStatus;
  predictedValue: number | null;
  target: string;
  unit: string;
  modelName: string;
  modelId: string;
  createdAt: string;
} | null;

export type DesignCandidate = {
  id: string;
  jobId: string;
  name: string;
  smilesCanonical: string;
  inchi: string;
  inchiKey: string;
  formula: string;
  molecularWeight: number | null;
  heavyAtomCount: number | null;
  templateId: string;
  templateFamily: string;
  chemicalClasses: string[];
  substituents: CandidateSubstituent[];
  seedIds: string[];
  generatorVersion: string;
  parameters: Record<string, unknown>;
  randomSeed: number | null;
  request: Record<string, unknown>;
  validationStatus: "valid" | "rejected";
  validation: { status: string; scope?: string; findings: ValidationFinding[] };
  structureSvg: string;
  existingMoleculeId: string;
  existingMoleculeName: string;
  /** True when the workspace already holds the structure, or the candidate was promoted. */
  inLibrary: boolean;
  promotedMoleculeId: string;
  verificationStatus: VerificationStatus;
  verificationNotes: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  latestAssessment: LatestAssessment;
  synthesisFeasibility: { status: "not_assessed" };
};

export type VerificationStatus = "not_verified" | "planned" | "verified" | "refuted";

export type GenerationResult = {
  jobId: string;
  candidateCount: number;
  existingInLibraryCount: number;
  duplicateCount: number;
  enumeratedTotal: number | null;
  proposedCount: number;
  substituentCount: number;
  substituents: CandidateSubstituent[];
  rejectedSubstituents: { source: string; sourceId?: string; source_id?: string; smiles: string; rules: string[] }[];
  rejectedStructureCount: number;
  rejectedStructures: { smiles?: string; substituents: string[]; findings: ValidationFinding[] }[];
  seedReports: {
    id: string;
    smiles: string;
    isPhosphateEster?: boolean;
    is_phosphate_ester?: boolean;
    substituentsExtracted?: number;
    substituents_extracted?: number;
    bricsFragments?: number;
    brics_fragments?: number;
    accepted: number;
    error: string;
  }[];
  template: { id: string; family: string; label: string; degree: number; formulaSketch?: string } | null;
  generatorVersion: string;
  parameters: Record<string, unknown>;
  randomSeed: number | null;
  request: Record<string, unknown>;
  warnings: string[];
  candidates: DesignCandidate[];
};

export type CandidatePage = { items: DesignCandidate[]; total: number; page: number; pageSize: number };

// --- Readiness and assessment -------------------------------------------------------------------

export type DesignReadiness = {
  target: string;
  label?: string;
  labelCode?: string;
  unit?: string;
  workspace: {
    moleculeCount: number;
    moleculesWithRealDescriptors: number;
    performanceResultCount: number;
    candidateCount: number;
  };
  models: TrainedModel[];
  dataset: {
    unrestricted: { rowCount: number; moleculeCount: number; report: Record<string, unknown> };
    singleAdditive: { rowCount: number; moleculeCount: number };
    scopeOptions: TrainingScopeOptions;
  } | null;
  status: "generationOnly" | "predictionAvailable";
  reasons: BackendMessage[];
};

export type TrainingScopeOptions = {
  target: string;
  label: string;
  labelCode?: string;
  unit: string;
  resultCount: number;
  singleAdditiveResultCount: number;
  multiAdditiveResultCount: number;
  resultsWithConditions: number;
  moleculeCount: number;
  testTypes: { value: string; resultCount: number; singleAdditiveResultCount: number }[];
};

export type AssessmentStatus = "supported" | "exploratory" | "unavailable";

/** How the selected model treats each condition of the application context. */
export type ConditionHandling = {
  concentration: "feature" | "notUsed";
  testType: "scopeFilter" | "coverageOnly";
  baseOil: "coverageOnly";
  temperature: "feature" | "coverageOnly";
  load: "feature" | "coverageOnly";
  otherComponents: "recordedOnly";
};

export type CoverageStatus = "covered" | "notCovered" | "notRequested" | "notRecorded" | "recordedOnly";

export type CandidateAssessment = {
  status: AssessmentStatus;
  structural: { status: "compliant" | "rejected"; template: string; findings: ValidationFinding[] };
  readiness: {
    status: "ready" | "unavailable";
    model: { id: string; name: string; featureSchemaVersion: string; concentrationBasis: string; datasetScope: DatasetScope };
    conditionHandling: ConditionHandling;
    reasons: BackendMessage[];
  };
  domain: {
    status: "within" | "outside" | "unknown";
    evidence?: {
      domain_recorded: boolean;
      feature_coverage: {
        compared_features: number;
        outside_range_count: number;
        fraction_in_range: number | null;
        outside_range: { feature: string; value: number; training_min: number; training_max: number; relative_distance: number | null }[];
      } | null;
      nearest_training: {
        method: string;
        training_molecule_count: number;
        max_similarity: number | null;
        nearest: { id: string; label: string; smiles: string; rows: number; similarity: number }[];
        identical_training_molecule: string | null;
      } | null;
      model_disagreement: { method: string; member_count: number; std: number; min: number; max: number } | null;
    };
  };
  conditionCoverage: {
    recorded: boolean;
    testType: { status: CoverageStatus; requested: string; training: Record<string, number> | null };
    baseOil: { status: CoverageStatus; requested: string; training: { id: string; name: string; rows: number }[] | null };
    concentration: { status: CoverageStatus; detail: { requested: number; trainingMin: number; trainingMax: number } | null };
    temperature: { status: CoverageStatus; detail: { requested: number; trainingMin: number; trainingMax: number } | null };
    load: { status: CoverageStatus; detail: { requested: number; trainingMin: number; trainingMax: number } | null };
    otherComponents: { status: "recordedOnly"; requested: string };
  } | null;
  validationSupport: {
    status: "unseenMolecules" | "formulationsOnly" | "ungrouped" | "none";
    grouping: string;
    splitMethod: string;
    metrics: { r2: number; mae: number; rmse: number; sample_count?: number; molecule_count?: number; group_count?: number } | null;
    trainingOnly: { r2: number; mae: number; rmse: number } | null;
    sampleCount: number;
    moleculeCount: number;
  };
  modelReasons: BackendMessage[];
  reasons: BackendMessage[];
  synthesisFeasibility: { status: "not_assessed" };
  modelEvidence: Record<string, unknown> | null;
};

export type AssessedCandidate = {
  predictionId: string;
  candidateId: string;
  candidateName: string;
  smilesCanonical: string;
  status: AssessmentStatus;
  predictedValue: number | null;
  target: string;
  unit: string;
  label: string;
  labelCode?: string;
  assessment: CandidateAssessment;
  createdAt: string;
};

export type AssessmentRun = {
  jobId: string;
  modelId: string;
  modelName: string;
  target: string;
  label: string;
  labelCode?: string;
  unit: string;
  context: ApplicationContext;
  conditionHandling: ConditionHandling;
  validationSupport: CandidateAssessment["validationSupport"];
  modelReasons: BackendMessage[];
  modelEvidence: Record<string, unknown> | null;
  counts: { supported: number; exploratory: number; unavailable: number };
  descriptorFailures: Record<string, string>;
  items: AssessedCandidate[];
  warnings: string[];
};

// --- Calls ----------------------------------------------------------------------------------------

type Envelope<T> = { data?: T } & Partial<T>;

function unwrap<T>(value: Envelope<T>): T {
  return (value?.data ?? value) as T;
}

const DESKTOP_ONLY =
  "Molecular design needs the desktop application: generation and assessment run in the packaged sidecar and candidates live in the workspace database.";

function desktopOnly(): never {
  throw new Error(coded("app.desktopOnly", DESKTOP_ONLY));
}

/** Reads the sidecar's snake_case catalogue into the camelCase shape the page uses. */
function readCatalogue(raw: Record<string, unknown>): DesignTemplateCatalogue {
  const templates = ((raw.templates as Record<string, unknown>[]) ?? []).map((item) => ({
    id: String(item.id),
    family: String(item.family),
    label: String(item.label),
    formulaSketch: String(item.formula_sketch ?? ""),
    degree: Number(item.degree),
    positions: (item.positions as number[]) ?? [],
    chemicalClasses: (item.chemical_classes as string[]) ?? [],
    description: String(item.description ?? ""),
    generatorVersion: String(item.generator_version ?? "")
  }));
  const limits = (raw.limits as Record<string, number>) ?? {};
  return {
    templates,
    curatedSubstituents: (raw.curated_substituents as CuratedSubstituent[]) ?? [],
    substituentSources: (raw.substituent_sources as string[]) ?? [],
    limits: {
      maxCandidates: limits.max_candidates ?? 500,
      maxSeeds: limits.max_seeds ?? 25,
      maxSubstituents: limits.max_substituents ?? 200
    },
    generatorVersion: String(raw.generator_version ?? "")
  };
}

export async function listDesignTemplates(): Promise<DesignTemplateCatalogue> {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<Record<string, unknown>>>("list_design_templates", {});
  return readCatalogue(unwrap(value));
}

export async function getDesignReadiness(target?: string): Promise<DesignReadiness> {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<DesignReadiness>>("get_design_readiness", {
    target: target ?? ""
  });
  return unwrap(value);
}

/** The scope choices the workspace records for one target, for the training controls. */
export async function describeTrainingScope(target: string): Promise<TrainingScopeOptions> {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<TrainingScopeOptions>>("describe_training_scope", { target });
  return unwrap(value);
}

/** Turns the page's constraint shape into the sidecar's. */
function constraintsPayload(constraints: SubstituentConstraints) {
  return {
    permitted_elements: constraints.permittedElements,
    allowed_types: constraints.allowedTypes,
    min_heavy_atoms: constraints.minHeavyAtoms,
    max_heavy_atoms: constraints.maxHeavyAtoms,
    max_branch_points: constraints.maxBranchPoints
  };
}

export async function runDesignGeneration(request: DesignRequest): Promise<GenerationResult> {
  if (!request.templateId && !request.seeds.length) {
    throw new Error(coded("design.requestInvalid", "Choose a template or provide seed molecules."));
  }
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<GenerationResult>>("run_design_generation", {
    request: {
      name: request.name ?? "",
      templateId: request.templateId ?? "",
      constraints: request.templateId ? constraintsPayload(request.constraints) : {},
      candidateConstraints: !request.templateId && request.candidateConstraints ? {
        permitted_elements: request.candidateConstraints.permittedElements,
        min_heavy_atoms: request.candidateConstraints.minHeavyAtoms,
        max_heavy_atoms: request.candidateConstraints.maxHeavyAtoms,
        max_branch_points: request.candidateConstraints.maxBranchPoints
      } : null,
      substituentSources: request.substituentSources,
      curatedSubstituentIds: request.curatedSubstituentIds ?? null,
      identicalSubstituents: request.identicalSubstituents ?? false,
      maxCandidates: request.maxCandidates,
      randomSeed: request.randomSeed ?? null,
      seeds: request.seeds,
      targetFunction: request.targetFunction ?? "",
      targetMetric: request.targetMetric ?? "",
      context: request.context
    }
  });
  return unwrap(value);
}

export async function listDesignCandidates(options: {
  jobId?: string;
  page?: number;
  pageSize?: number;
  includeSvg?: boolean;
} = {}): Promise<CandidatePage> {
  if (!isTauriRuntime()) return { items: [], total: 0, page: 1, pageSize: options.pageSize ?? 50 };
  const value = await invokeCommand<Envelope<CandidatePage>>("list_design_candidates", {
    jobId: options.jobId ?? null,
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
    includeSvg: options.includeSvg ?? true
  });
  return unwrap(value);
}

export async function listDesignJobs(limit = 25) {
  if (!isTauriRuntime()) return [] as unknown[];
  const value = await invokeCommand<Envelope<{ items: unknown[] }>>("list_design_jobs", { limit });
  return unwrap(value).items;
}

export async function assessDesignCandidates(options: {
  candidateIds: string[];
  modelId: string;
  context: ApplicationContext;
}): Promise<AssessmentRun> {
  if (!options.modelId) {
    throw new Error(coded("model.notChosen", "No model id was supplied."));
  }
  if (options.candidateIds.length === 0) {
    throw new Error(coded("app.selectionRequired", "No candidate was selected to assess."));
  }
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<AssessmentRun>>("assess_design_candidates", {
    candidateIds: options.candidateIds,
    modelId: options.modelId,
    context: options.context
  });
  return unwrap(value);
}

export async function promoteDesignCandidate(options: {
  candidateId: string;
  name?: string;
  category?: string;
  tags?: string[];
}): Promise<{ candidate: DesignCandidate; moleculeId: string; moleculeName: string }> {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<{ candidate: DesignCandidate; moleculeId: string; moleculeName: string }>>(
    "promote_design_candidate",
    {
      candidateId: options.candidateId,
      name: options.name ?? null,
      category: options.category ?? null,
      tags: options.tags ?? null
    }
  );
  return unwrap(value);
}

export async function updateDesignCandidateVerification(options: {
  candidateId: string;
  status: VerificationStatus;
  notes?: string;
}): Promise<{ candidate: DesignCandidate }> {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<{ candidate: DesignCandidate }>>(
    "update_design_candidate_verification",
    { candidateId: options.candidateId, status: options.status, notes: options.notes ?? "" }
  );
  return unwrap(value);
}

export async function exportDesignCandidates(candidateIds: string[]): Promise<ExportResult> {
  if (!isTauriRuntime()) desktopOnly();
  return unwrapExport(
    invokeCommand("export_design_candidates", { candidateIds }),
    "design-candidates.csv"
  );
}
