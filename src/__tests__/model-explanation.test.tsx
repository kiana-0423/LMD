// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";
import type { ModelExplanation } from "../lib/modelExplanationApi";
const mock = vi.hoisted(() => ({ explain: vi.fn(), charts: vi.fn() }));
vi.mock("../lib/modelExplanationApi", () => ({ explainMoleculeModel: mock.explain }));
vi.mock("../components/EChartCanvas", () => ({ default: (props: unknown) => { mock.charts(props); return <div data-testid="shap-chart" />; } }));
import ModelExplanationWindow from "../features/data-mining/ModelExplanationWindow";

const request = { modelId: "model-1", modelName: "Friction model", items: [] };
const en = messagesForLanguage("en-US");
const fixture: ModelExplanation = {
  modelId: "model-1", modelName: "Friction model", target: "friction", trainedAt: "2026-09-07", skipped: [],
  explanation: {
    mode: "real", method: "LinearExplainer / independent", shap_version: "0.49.1", algorithm: "ridge", target: "friction",
    feature_schema_version: "4", cohort: "training_reference", total_count: 40, sample_count: 2,
    reference_count: 40, background_count: 40, background_kind: "sampled_reference", seed: 42,
    feature_names: ["rdkit_MolWt", "concentration"],
    importance: [{ feature: "rdkit_MolWt", mean_abs_shap: 0.3 }, { feature: "concentration", mean_abs_shap: 0.1 }],
    samples: [
      { id: "a", label: "Molecule A", prediction: 0.7, base_value: 0.5, shap_values: [0.3, -0.1], feature_values: [200, 1] },
      { id: "b", label: "Molecule B", prediction: 0.3, base_value: 0.5, shap_values: [-0.3, 0.1], feature_values: [100, 2] }
    ]
  }
};
beforeEach(() => { vi.clearAllMocks(); mock.explain.mockResolvedValue(fixture); });
afterEach(cleanup);

it("labels the teaching case and displays its calculated reference separately from predictions", async () => {
  mock.explain.mockResolvedValue({ ...fixture, explanation: { ...fixture.explanation,
    samples: [{ ...fixture.explanation.samples[0], reference_value: 1.234 }]
  } });
  renderWithLanguage(<ModelExplanationWindow request={{ modelId: "rdkit_clogp", example: "rdkit_clogp", items: [] }} />);
  await screen.findByTestId("shap-chart");
  expect(screen.getByText(en["shap.exampleTitle"])).toBeTruthy();
  expect(screen.getByText(en["shap.exampleHelp"], { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: en["shap.local"] }));
  expect(screen.getByText(/RDKit calculated reference cLogP: 1.23400/)).toBeTruthy();
});

it("renders real response importance and switches distribution and individual contributions", async () => {
  renderWithLanguage(<ModelExplanationWindow request={request} />);
  await screen.findByTestId("shap-chart");
  expect(mock.explain).toHaveBeenCalledWith(request);
  expect(screen.getByText("rdkit_MolWt")).toBeTruthy();
  const chart = () => mock.charts.mock.calls[mock.charts.mock.calls.length - 1]![0].option;
  expect(chart().series[0].data).toEqual([0.3, 0.1]);
  fireEvent.click(screen.getByRole("tab", { name: en["shap.distribution"] }));
  expect(chart().series[0].type).toBe("scatter");
  expect(chart().series[0].data).toHaveLength(4);
  fireEvent.click(screen.getByRole("tab", { name: en["shap.local"] }));
  expect(chart().series[0].data.map((item: { value: number }) => item.value)).toEqual([0.3, -0.1]);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: en["shap.sample"] }));
  fireEvent.click(await screen.findByTitle("Molecule B (2)"));
  expect(chart().series[0].data.map((item: { value: number }) => item.value)).toEqual([-0.3, 0.1]);
});

it("keeps remaining feature contributions in the local chart so the equation stays complete", async () => {
  const names = Array.from({ length: 16 }, (_, index) => `feature_${index}`);
  mock.explain.mockResolvedValue({ ...fixture, explanation: { ...fixture.explanation,
    feature_names: names, importance: names.map((feature) => ({ feature, mean_abs_shap: 1 })),
    samples: [{ ...fixture.explanation.samples[0], shap_values: names.map(() => 1), feature_values: names.map(() => 2), prediction: 16.5 }]
  } });
  renderWithLanguage(<ModelExplanationWindow request={request} />);
  await screen.findByTestId("shap-chart");
  fireEvent.click(screen.getByRole("tab", { name: en["shap.local"] }));
  const series = mock.charts.mock.calls[mock.charts.mock.calls.length - 1]![0].option.series[0].data;
  expect(series).toHaveLength(13);
  expect(series[series.length - 1].value).toBe(4);
  expect(series.reduce((sum: number, item: { value: number }) => sum + item.value, 0)).toBe(16);
});

it("shows retraining guidance for legacy models and retries without displaying invented plots", async () => {
  mock.explain.mockRejectedValueOnce(new Error("[model.explanationReferenceMissing] No saved reference"));
  renderWithLanguage(<ModelExplanationWindow request={request} />);
  await screen.findByText(en["shap.failed"]);
  expect(screen.getByText(en["shap.referenceMissing"], { exact: false })).toBeTruthy();
  expect(screen.queryByTestId("shap-chart")).toBeNull();
  const retry = screen.getByRole("button", { name: new RegExp(en["shap.recalculate"]) });
  await waitFor(() => expect(retry.classList.contains("ant-btn-loading")).toBe(false));
  fireEvent.click(retry);
  await screen.findByTestId("shap-chart");
  await waitFor(() => expect(mock.explain).toHaveBeenCalledTimes(2));
});
