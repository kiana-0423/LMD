import type {
  Attachment,
  EntityDeletion,
  EntityPage,
  Experiment,
  PerformanceResult
} from "../../types";
import type { ExperimentPerformancePayload } from "./payloads";
import { toEntityDeletion } from "./deletion";
import { invokeCommand } from "../tauri";

/** What the two experiment lookups return. */
export type ExperimentWithResults = {
  /** The single experiment asked for by id; absent when the caller asked by formulation. */
  experiment?: Experiment;
  /** Every experiment, when the caller asked by formulation. Empty for a single-id lookup. */
  experiments: Experiment[];
  results: PerformanceResult[];
};

export async function listExperiments() {
  return invokeCommand<Experiment[]>("list_experiments", { filter: null });
}

export async function listExperimentPage(
  request: { page?: number; pageSize?: number; search?: string } = {}
) {
  return invokeCommand<EntityPage<Experiment>>("list_experiments_page", { request });
}

export async function listPerformanceResults() {
  return invokeCommand<PerformanceResult[]>("list_performance_results", { filter: null });
}

export async function listPerformanceResultPage(
  request: { page?: number; pageSize?: number } = {}
) {
  return invokeCommand<EntityPage<PerformanceResult>>("list_performance_results_page", { request });
}

/**
 * Saves a test run and its measurements as one record.
 *
 * This was two calls — `create_experiment`, then `create_performance_result` — and when the second
 * failed the first had already committed. What remained was an experiment with no measurements,
 * which looks exactly like a test whose results are still being entered. One command now writes
 * both rows in one SQLite transaction, or neither.
 */
export async function saveExperimentWithPerformance(payload: ExperimentPerformancePayload) {
  return invokeCommand<{ experiment: Experiment; result: PerformanceResult }>(
    "save_experiment_with_performance",
    { payload }
  );
}

/** One experiment with the results measured for it, read by targeted query. */
export async function getExperimentWithResults(id: string) {
  return invokeCommand<ExperimentWithResults>("get_experiment_with_results", { id });
}

/**
 * Every experiment recorded against one formulation, with its results.
 *
 * The formulation screen used to read every experiment and every performance result in the
 * workspace and filter both in the browser to find the handful attached to one blend.
 */
export async function listFormulationExperiments(formulationId: string) {
  return invokeCommand<ExperimentWithResults>("list_formulation_experiments", { formulationId });
}

export async function deleteExperimentRecord(experimentId: string): Promise<EntityDeletion> {
  return toEntityDeletion(await invokeCommand<unknown>("delete_experiment", { id: experimentId }));
}

export async function updateExperimentRecord(
  experimentId: string,
  payload: Partial<ExperimentPerformancePayload>
) {
  return invokeCommand<Experiment>("update_experiment", { id: experimentId, payload });
}

export async function updatePerformanceResultRecord(
  resultId: string,
  payload: Partial<ExperimentPerformancePayload>
) {
  return invokeCommand<PerformanceResult>("update_performance_result", { id: resultId, payload });
}

export async function deletePerformanceResultRecord(resultId: string) {
  return invokeCommand<{ success: boolean; deleted: boolean }>("delete_performance_result", {
    id: resultId
  });
}

export async function listAttachments(linkedEntityType: string, linkedEntityId: string) {
  return invokeCommand<Attachment[]>("list_attachments", { linkedEntityType, linkedEntityId });
}

// Attachment deletion has one implementation for every entity type; see `deleteAttachmentRecord`.
export { deleteAttachmentRecord } from "./molecule";
export type { ExperimentPerformancePayload };
