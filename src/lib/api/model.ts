import type { ExportResult } from "../../types";
import { invokeCommand, isTauriRuntime } from "../tauri";
import { unwrapExport } from "./export";
import { coded } from "../backendErrors";
import type { BackendMessage } from "../backendMessages";

export type ModelMetrics = {
  validation?: { sampleCount?: number; sample_count?: number; r2: number; mae: number; rmse: number };
  training_only?: { sampleCount?: number; sample_count?: number; r2: number; mae: number; rmse: number };
};

/**
 * The two dataset semantics a model can be trained under. They answer different questions and are
 * never interchangeable, so a prediction request is addressed to one or the other.
 *
 * - `additive_component`: one row per additive molecule, at its own concentration.
 * - `formulation_aggregate`: one row per formulation, with additive descriptors combined by
 *   concentration-weighted mean alongside base-oil properties.
 */
export type DatasetMode = "additive_component" | "formulation_aggregate";

export type TrainedModel = {
  id: string;
  name: string;
  target: string;
  task: string;
  algorithm: string;
  modelVersion: string;
  featureOrder: string[];
  metrics: ModelMetrics;
  sampleCount: number;
  featureCount: number;
  trainedAt: string;
  splitMethod: string;
  datasetMode: DatasetMode;
  interpretation: string;
  groupCount: number;
  validated: boolean;
  /** The feature definition this model was fitted under. */
  featureSchemaVersion: string;
  /** How its concentrations were recorded: `wt%`, `unrecorded`, or `none`. */
  concentrationBasis: string;
  /** False when this build cannot read the recorded basis, which also makes the model unusable. */
  concentrationBasisReadable?: boolean;
  /** How the validation split was made, as a translatable message. */
  splitMethodMessage?: BackendMessage;
  /** What one row of this model's dataset means, as a translation key. */
  interpretationCode?: string;
  /**
   * False when the model predates the current feature definition, or records a basis this build
   * does not define. Either way the columns cannot be trusted and the model must be retrained.
   */
  usable: boolean;
};

export type DatasetReport = {
  consideredJoins: number;
  resultCount: number;
  multiAdditiveResultCount: number;
  excludedMissingTarget: number;
  excludedNoDescriptors: number;
  excludedIncompatibleUnits: number;
  excludedMixedUnits: number;
  excludedPartialConcentration: number;
  /** Negative, non-finite, or all-zero concentrations: values that cannot describe a blend. */
  excludedNonphysical: number;
  excludedOtherBasis: number;
  excludedForUnits: number;
  concentrationBasis: string;
  warnings: BackendMessage[];
};

export type TrainingSummary = {
  modelId: string;
  target: string;
  label: string;
  unit: string;
  algorithm: string;
  modelVersion: string;
  trainedAt: string;
  sampleCount: number;
  excludedCount: number;
  featureCount: number;
  featureOrder: string[];
  droppedFeatures: string[];
  metrics: ModelMetrics;
  /** How the validation split was made, so an in-sample score is never mistaken for held-out. */
  splitMethod: string;
  groupCount: number;
  validated: boolean;
  /** Which dataset semantics produced the rows: per additive component, or per formulation. */
  datasetMode: DatasetMode;
  interpretation: string;
  /** The same interpretation as a translation key. */
  interpretationCode?: string;
  splitMethodMessage?: BackendMessage;
  featureSchemaVersion: string;
  concentrationBasis: string;
  multiAdditiveResultCount: number;
  resultCount: number;
  excludedForUnits: number;
  datasetReport: DatasetReport;
  warnings: BackendMessage[];
};

/** One record the model could not describe, and the reason in words the user can act on. */
export type SkippedPrediction = {
  id: string;
  label: string;
  /** The English diagnostic. Shown beside the translated sentence, never instead of it. */
  reason?: string;
  /** The same reason as a code and its parameters, so it can be read in any language. */
  reasonMessage?: BackendMessage;
  missingCount?: number;
  missing?: string[];
};

export type PredictionResult = {
  modelId: string;
  modelName: string;
  target: string;
  algorithm: string;
  trainedAt: string;
  sampleCount: number;
  datasetMode: DatasetMode;
  concentrationBasis: string;
  splitMethodMessage?: BackendMessage;
  interpretationCode?: string;
  metrics: ModelMetrics;
  predictions: { id: string; label: string; value: number }[];
  skipped: SkippedPrediction[];
};

/** One molecule to predict on with an additive-component model. */
export type MoleculePredictionItem = {
  moleculeId: string;
  concentration?: number;
  concentrationUnit?: string;
};

/** A blend described by hand rather than stored in the workspace. */
export type CandidateFormulation = {
  name?: string;
  additives: { moleculeId: string; concentration?: number; concentrationUnit?: string }[];
  baseOils?: { baseOilId: string; concentration?: number; concentrationUnit?: string }[];
};

type Envelope<T> = { data?: T } & Partial<T>;

function unwrap<T>(value: Envelope<T>): T {
  return (value?.data ?? value) as T;
}

/** Training and prediction need the workspace database and the packaged sidecar. */
const DESKTOP_ONLY =
  "Model training and prediction require the desktop application, where the workspace database and the Python sidecar are available.";

function desktopOnly(): never {
  throw new Error(coded("app.desktopOnly", DESKTOP_ONLY));
}

export async function trainModel(options: {
  target: string;
  algorithm?: string;
  descriptorSet?: string;
  /** Required: a page trains one kind of model, and the model records which kind it is. */
  datasetMode: DatasetMode;
  name?: string;
}) {
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<TrainingSummary>>("train_model", {
    target: options.target,
    algorithm: options.algorithm ?? "auto",
    descriptorSet: options.descriptorSet ?? "",
    datasetMode: options.datasetMode,
    name: options.name ?? null
  });
  return unwrap(value);
}

/**
 * Predicts with an additive-component model: one molecule, at one concentration, per item.
 *
 * The model id is required. Without it a prediction could silently come from a model trained on
 * other semantics, and the returned number would look exactly as trustworthy as a correct one.
 */
export async function predictMoleculePerformance(options: {
  modelId: string;
  items: MoleculePredictionItem[];
}) {
  if (!options.modelId) {
    throw new Error(coded("model.notChosen", "No model id was supplied."));
  }
  if (options.items.length === 0) {
    throw new Error(coded("app.selectionRequired", "No molecule was selected to predict."));
  }
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<PredictionResult>>("predict_molecule_performance", {
    modelId: options.modelId,
    items: options.items
  });
  return unwrap(value);
}

/**
 * Predicts with a formulation-aggregate model, from stored formulations or candidate blends.
 *
 * A molecule picker has no place here: an aggregate model describes a whole mixture, so it needs
 * every additive and base oil, not one molecule.
 */
export async function predictFormulationPerformance(options: {
  modelId: string;
  formulationIds?: string[];
  candidates?: CandidateFormulation[];
}) {
  if (!options.modelId) {
    throw new Error(coded("model.notChosen", "No model id was supplied."));
  }
  const formulationIds = options.formulationIds ?? [];
  const candidates = options.candidates ?? [];
  if (formulationIds.length === 0 && candidates.length === 0) {
    throw new Error(
      coded("app.selectionRequired", "No stored formulation or candidate blend was supplied.")
    );
  }
  if (!isTauriRuntime()) desktopOnly();
  const value = await invokeCommand<Envelope<PredictionResult>>("predict_formulation_performance", {
    modelId: options.modelId,
    formulationIds,
    candidates
  });
  return unwrap(value);
}

/**
 * Trained models for one target, optionally narrowed to one dataset mode.
 *
 * A page that can only use one kind of model asks for that kind, so a formulation-level model
 * never appears in a molecule-level picker.
 */
export async function listModels(target?: string, datasetMode?: DatasetMode) {
  if (!isTauriRuntime()) return [] as TrainedModel[];
  const value = await invokeCommand<Envelope<{ items: TrainedModel[] }>>("list_models", {
    target: target ?? "",
    datasetMode: datasetMode ?? ""
  });
  return unwrap(value).items;
}

export async function listModelJobs(limit = 25) {
  if (!isTauriRuntime()) return [];
  const value = await invokeCommand<Envelope<{ items: unknown[] }>>("list_model_jobs", { limit });
  return unwrap(value).items;
}

export async function exportMlDataset(
  target: string,
  descriptorSet = "",
  datasetMode: DatasetMode = "additive_component"
): Promise<ExportResult> {
  if (!isTauriRuntime()) desktopOnly();
  return unwrapExport(
    invokeCommand("export_ml_dataset", { target, descriptorSet, datasetMode }),
    "ml-dataset.csv"
  );
}
