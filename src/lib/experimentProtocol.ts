import type { ExperimentPerformancePayload } from "./api/payloads";
import type { MessageKey } from "../i18n/LanguageContext";

export const TEST_TYPES: { value: string; labelKey?: MessageKey }[] = [
  { value: "UMT" }, { value: "four-ball", labelKey: "ui.fourBallTest" },
  { value: "TE77" }, { value: "PDSC" }, { value: "TGA" },
  { value: "kinematic-viscosity", labelKey: "ui.viscosityTest" },
  { value: "corrosion", labelKey: "ui.corrosionTest" }, { value: "other", labelKey: "ui.other" }
];

export type TestParameters = {
  mode?: string | null;
  strokeMm?: number | null;
  frequencyHz?: number | null;
  radiusMm?: number | null;
  speedRpm?: number | null;
  ambientTemperatureC?: number | null;
  humidityPercent?: number | null;
  environmentProvenance?: Record<string, { source: "measured" | "mean" | "missing"; sampleCount?: number }>;
};

export const PERFORMANCE_FIELDS = ["averageFrictionCoefficient", "stableFrictionCoefficient", "wearScarDiameterValue", "wearScarWidthValue",
  "initialOxidationTemperatureValue", "initialDecompositionTemperatureValue", "extremePressureValue", "pbValue", "pdValue", "viscosity40c", "viscosity100c"] as const;

export function performanceFields(testType: string, temperature?: number): readonly string[] {
  if (["UMT", "four-ball", "TE77", "SRV", "ball-on-disk"].includes(testType)) {
    return ["averageFrictionCoefficient", "stableFrictionCoefficient", "wearScarDiameterValue", "wearScarWidthValue",
      ...(testType === "four-ball" ? ["extremePressureValue", "pbValue", "pdValue"] : [])];
  }
  if (testType === "PDSC") return ["initialOxidationTemperatureValue"];
  if (testType === "TGA") return ["initialDecompositionTemperatureValue"];
  if (testType === "kinematic-viscosity") return temperature === 40 ? ["viscosity40c"] : temperature === 100 ? ["viscosity100c"] : [];
  return testType ? PERFORMANCE_FIELDS : [];
}

/** Explicit nulls also clear results that belonged to a previously selected test type. */
export function experimentPayload(values: Record<string, unknown>): ExperimentPerformancePayload {
  const type = String(values.testType ?? "");
  const parameters: TestParameters = { ...(values.testParameters as TestParameters ?? {}) };
  parameters.environmentProvenance = undefined;
  if (type === "TE77") parameters.mode = "reciprocating";
  if (!["UMT", "TE77"].includes(type)) parameters.mode = null;
  if (parameters.mode !== "reciprocating") { parameters.strokeMm = null; parameters.frequencyHz = null; }
  if (parameters.mode !== "ball-on-disk") parameters.radiusMm = null;
  if (type !== "four-ball" && parameters.mode !== "ball-on-disk") parameters.speedRpm = null;
  const allowed = performanceFields(type, values.temperatureValue as number | undefined);
  const results = Object.fromEntries(PERFORMANCE_FIELDS.map((key) => [key, allowed.includes(key) ? values[key] ?? null : null]));
  const tribology = ["UMT", "four-ball", "TE77", "SRV", "ball-on-disk", "other"].includes(type);
  return { ...values, ...results, testParameters: parameters,
    loadValue: tribology ? values.loadValue ?? null : null,
    upperMaterial: tribology ? values.upperMaterial ?? null : null,
    lowerMaterial: tribology ? values.lowerMaterial ?? null : null,
    loadUnit: "N", temperatureUnit: "C", durationUnit: "min"
  } as unknown as ExperimentPerformancePayload;
}
