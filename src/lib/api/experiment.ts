import type { Experiment, PerformanceResult } from "../../types";
import {
  mockDeleteExperimentRecord,
  mockListExperiments,
  mockListPerformanceResults,
  mockSaveExperimentWithPerformance,
  mockUpdateExperimentRecord,
  type ExperimentPerformancePayload
} from "../api.mock";
import { invokeOrMock, isTauriRuntime } from "../tauri";

export async function listExperiments() {
  return invokeOrMock<Experiment[]>("list_experiments", { filter: null }, mockListExperiments);
}

export async function listPerformanceResults() {
  return invokeOrMock<PerformanceResult[]>("list_performance_results", { filter: null }, mockListPerformanceResults);
}

export async function saveExperimentWithPerformance(payload: ExperimentPerformancePayload) {
  if (!isTauriRuntime()) {
    return mockSaveExperimentWithPerformance(payload);
  }
  const experiment = await invokeOrMock<Experiment>("create_experiment", { payload }, async () => {
    const result = await mockSaveExperimentWithPerformance(payload);
    return result.experiment;
  });
  const result = await invokeOrMock<PerformanceResult>(
    "create_performance_result",
    { payload: { ...payload, experimentId: experiment.id } },
    async () => {
      const saved = await mockSaveExperimentWithPerformance(payload);
      return saved.result;
    }
  );
  return { experiment, result };
}

export async function deleteExperimentRecord(experimentId: string) {
  return mockDeleteExperimentRecord(experimentId);
}

export async function updateExperimentRecord(experimentId: string, payload: Partial<ExperimentPerformancePayload>) {
  return mockUpdateExperimentRecord(experimentId, payload);
}
