import { coded } from "./backendErrors";
import { invokeCommand } from "./tauri";
import type { MoleculePredictionItem, SkippedPrediction } from "./api/model";

export type ExplanationRequest = { modelId: string; modelName?: string; items: MoleculePredictionItem[]; example?: "rdkit_clogp" };
export type ShapSample = {
  id: string; label: string; prediction: number; base_value: number;
  shap_values: number[]; feature_values: (number | null)[];
  reference_value?: number;
};
export type ModelExplanation = {
  modelId: string; modelName: string; target: string; targetLabel?: string; targetLabelCode?: string; unit?: string; trainedAt: string; skipped: SkippedPrediction[];
  caseStudy?: { id: string; version: number; rdkit_version: string; sample_count: number; feature_count: number; algorithm: string };
  explanation: {
    mode: "real"; method: string; shap_version: string; algorithm: string; target: string;
    feature_schema_version: string; cohort: "selected_molecules" | "training_reference";
    total_count: number; sample_count: number; reference_count: number; background_count: number; seed: number;
    background_kind: "sampled_reference" | "tree_path_counts";
    feature_names: string[]; importance: { feature: string; mean_abs_shap: number }[]; samples: ShapSample[];
  };
};

declare global {
  interface Window { __LMD_EXPLANATION__?: ExplanationRequest }
}

export function openModelExplanation(request: ExplanationRequest) {
  return invokeCommand<void>("open_model_explanation", { modelId: request.modelId, items: request.items });
}

export function openModelExample() {
  return invokeCommand<void>("open_model_example");
}

export async function explainMoleculeModel(request: ExplanationRequest) {
  const result = request.example
    ? await invokeCommand<{ data: ModelExplanation }>("explain_model_example")
    : await invokeCommand<{ data: ModelExplanation }>("explain_molecule_model", {
    modelId: request.modelId, items: request.items
  });
  if (!result.data?.explanation?.samples?.length) throw new Error(coded("model.explanationFailed", "SHAP returned no explanation samples."));
  return result.data;
}
