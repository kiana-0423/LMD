import { invokeCommand } from "../tauri";
import type { BackendMessage } from "../backendMessages";

/** Shape shared by every analysis command: a status, metadata, and a series.
 *
 * Everything a user reads is a message descriptor rather than a sentence. `field` and `label` are
 * the exceptions and stay as they are: `field` is a column name and `label` is the English
 * fallback for `labelCode`, used only when this build does not carry that key.
 */
export type AnalysisMetadata = {
  recordCount: number;
  excludedCount: number;
  /** How records with no value were treated. */
  missingValueMessage?: BackendMessage;
  field: string;
  /** The translation key for this metric's name. */
  labelCode?: string;
  label: string;
  unit: string;
  /** What the analysis actually computed. */
  methodMessage?: BackendMessage;
  [key: string]: unknown;
};

export type AnalysisResult<T> = {
  status: "ok" | "insufficient_data";
  /** Why there is nothing to show, when the status says so. */
  message?: BackendMessage;
  metadata: AnalysisMetadata;
  series: T[];
  warnings?: BackendMessage[];
  [key: string]: unknown;
};

export type DistributionBin = { binStart: number; binEnd: number; count: number; label: string };
export type GroupSummary = {
  groupId: string;
  label: string;
  summary: { count: number; mean: number; median: number; stdDev: number; min: number; max: number };
};
export type ConcentrationPoint = {
  label: string;
  concentration: number;
  concentrationUnit: string;
  value: number;
};
export type CorrelationRow = {
  descriptor: string;
  sampleCount: number;
  pearson: number;
  spearman: number | null;
};

type Envelope<T> = { data?: T } & Partial<T>;

function unwrap<T>(value: Envelope<T>): T {
  return (value?.data ?? value) as T;
}

export async function listPerformanceMetrics() {
  const value = await invokeCommand<
    Envelope<{ metrics: { column: string; labelCode?: string; label: string; unit: string }[] }>
  >("list_performance_metrics", {});
  return unwrap(value).metrics;
}

export async function getPerformanceDistribution(metric: string, binCount = 10) {
  const value = await invokeCommand<Envelope<AnalysisResult<DistributionBin>>>(
    "get_performance_distribution",
    { metric, binCount }
  );
  return unwrap(value);
}

export async function comparePerformanceByGroup(group: string, metric: string, minSamples = 1) {
  const value = await invokeCommand<Envelope<AnalysisResult<GroupSummary>>>(
    "compare_performance_by_group",
    { group, metric, minSamples }
  );
  return unwrap(value);
}

export async function getConcentrationPerformance(metric: string, additiveId?: string) {
  const value = await invokeCommand<Envelope<AnalysisResult<ConcentrationPoint>>>(
    "get_concentration_performance",
    { metric, additiveId: additiveId ?? null }
  );
  return unwrap(value);
}

export async function getDescriptorPropertyCorrelation(metric: string, descriptorSet = "", top = 25) {
  const value = await invokeCommand<Envelope<AnalysisResult<CorrelationRow>>>(
    "get_descriptor_property_correlation",
    { metric, descriptorSet, top }
  );
  return unwrap(value);
}
