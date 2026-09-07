// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";

const explanationMock = vi.hoisted(() => ({ openModelExplanation: vi.fn(), openModelExample: vi.fn() }));
vi.mock("../lib/modelExplanationApi", () => explanationMock);

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";

const en = messagesForLanguage("en-US");

const METRICS = [
  { column: "average_friction_coefficient", label: "Average friction coefficient", unit: "" },
  { column: "stable_friction_coefficient", label: "Stable friction coefficient", unit: "" },
  { column: "wear_scar_diameter_value", label: "Wear scar diameter", unit: "um" },
  { column: "wear_scar_width_value", label: "Wear scar width", unit: "um" }
];

const MODEL = {
  id: "model-1",
  name: "Friction model",
  target: "average_friction_coefficient",
  task: "regression",
  algorithm: "ridge",
  modelVersion: "1",
  featureOrder: ["rdkit_MolWt", "concentration"],
  metrics: {},
  sampleCount: 24,
  featureCount: 2,
  trainedAt: "2026-01-01",
  splitMethod: "none",
  datasetMode: "additive_component" as const,
  interpretation: "",
  groupCount: 12,
  validated: true,
  featureSchemaVersion: "3",
  concentrationBasis: "wt%",
  usable: true
};

function seed() {
  apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
  apiMock.listModels.mockResolvedValue([MODEL]);
  apiMock.listMoleculePage.mockResolvedValue({
    items: [{ id: "mol-1", name: "ZDDP" }],
    total: 1,
    page: 1,
    pageSize: 200
  });
  apiMock.predictMoleculePerformance.mockResolvedValue({
    modelId: "model-1",
    modelName: "Friction model",
    target: "average_friction_coefficient",
    algorithm: "ridge",
    trainedAt: "2026-01-01",
    sampleCount: 24,
    datasetMode: "additive_component",
    concentrationBasis: "wt%",
    metrics: {},
    predictions: [{ id: "mol-1", label: "ZDDP", value: 0.06123 }],
    skipped: []
  });
}

beforeEach(async () => {
  window.localStorage.clear();
  explanationMock.openModelExplanation.mockReset();
  explanationMock.openModelExplanation.mockResolvedValue(undefined);
  explanationMock.openModelExample.mockReset();
  explanationMock.openModelExample.mockResolvedValue(undefined);
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
});

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

/** Selects the model row, picks a molecule, enters a concentration, and predicts. */
async function predictOnce() {
  // The model table's radio selects which model a prediction is attributed to.
  fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));
  const picker = await screen.findByRole("combobox", { name: en["model.selectMoleculesToPredict"] });
  fireEvent.mouseDown(picker);
  fireEvent.click(await screen.findByTitle("ZDDP"));
  // Nothing is pre-filled: this model was fitted on weight-percent concentrations, so one has to
  // be entered before there is anything to predict.
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));
  await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
  expect(await screen.findByText("0.06123")).toBeTruthy();
}

describe("a prediction is never shown for inputs that changed", () => {
  it("opens the teaching case with no registered model or selected molecules", async () => {
    seed();
    apiMock.listModels.mockResolvedValue([]);
    apiMock.listMoleculePage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    fireEvent.click(await screen.findByRole("button", { name: en["shap.exampleOpen"] }));
    await waitFor(() => expect(explanationMock.openModelExample).toHaveBeenCalledTimes(1));
    expect(apiMock.trainModel).not.toHaveBeenCalled();
    expect(apiMock.predictMoleculePerformance).not.toHaveBeenCalled();
  });
  it("marks it stale when the target property changes", async () => {
    seed();
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await predictOnce();

    fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));

    // The friction value must not reappear under a wear-scar column heading.
    expect(await screen.findByText(en["model.staleTitle"])).toBeTruthy();
    expect(screen.queryByText("0.06123")).toBeNull();
  });

  it("marks it stale when the selected molecules change", async () => {
    seed();
    apiMock.listMoleculePage.mockResolvedValue({
      items: [
        { id: "mol-1", name: "ZDDP" },
        { id: "mol-2", name: "MoDTC" }
      ],
      total: 2,
      page: 1,
      pageSize: 200
    });
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await predictOnce();

    const picker = screen.getByRole("combobox", { name: en["model.selectMoleculesToPredict"] });
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByTitle("MoDTC"));

    expect(await screen.findByText(en["model.staleTitle"])).toBeTruthy();
    expect(screen.queryByText("0.06123")).toBeNull();
  });

  it("marks it stale when the concentration changes", async () => {
    seed();
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await predictOnce();

    const concentration = screen.getByRole("spinbutton");
    fireEvent.change(concentration, { target: { value: "2.5" } });

    expect(await screen.findByText(en["model.staleTitle"])).toBeTruthy();
    expect(screen.queryByText("0.06123")).toBeNull();
  });

  it("keeps showing the prediction while nothing has changed", async () => {
    seed();
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await predictOnce();

    expect(screen.queryByText(en["model.staleTitle"])).toBeNull();
    expect(screen.getByText("0.06123")).toBeTruthy();
  });

  it("opens SHAP in a new window using the same selected molecules and concentrations as prediction", async () => {
    seed();
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await predictOnce();
    fireEvent.click(screen.getByRole("button", { name: en["shap.open"] }));
    await waitFor(() => expect(explanationMock.openModelExplanation).toHaveBeenCalledWith({
      modelId: "model-1", items: [{ moleculeId: "mol-1", concentration: 1.5, concentrationUnit: "wt%" }]
    }));
  });

  it("clears a training summary when the target changes", async () => {
    seed();
    apiMock.trainModel.mockResolvedValue({
      modelId: "model-1",
      target: "average_friction_coefficient",
      label: "Average friction coefficient",
      unit: "",
      algorithm: "ridge",
      modelVersion: "1",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      excludedCount: 0,
      featureCount: 2,
      featureOrder: [],
      droppedFeatures: [],
      metrics: {},
      splitMethod: "none",
      groupCount: 12,
      validated: true,
      datasetMode: "additive_component",
      interpretation: "One row per additive component.",
      featureSchemaVersion: "3",
      concentrationBasis: "wt%",
      multiAdditiveResultCount: 0,
      resultCount: 24,
      excludedForUnits: 0,
      datasetReport: { warnings: [] },
      warnings: []
    });
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    fireEvent.click(await screen.findByRole("button", { name: en["model.train"] }));
    expect(await screen.findByText("One row per additive component.")).toBeTruthy();

    fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));

    // A summary measured for friction must not sit under a wear-scar heading.
    await waitFor(() =>
      expect(screen.queryByText("One row per additive component.")).toBeNull()
    );
  });

  it("keeps training controls available after completion and retains metrics and all notices", async () => {
    seed();
    apiMock.trainModel.mockResolvedValue({
      ...MODEL, modelId: MODEL.id, sampleCount: 8, moleculeCount: 6, featureCount: 2,
      excludedCount: 1, excludedForUnits: 1, multiAdditiveResultCount: 0,
      metrics: { training_only: { r2: 0.89, mae: 0.1, rmse: 0.2, sampleCount: 8 } },
      warnings: [{ detail: "First training warning" }, { detail: "Second training warning" }],
      datasetReport: { warnings: [{ detail: "One row has a conflicting unit" }] }
    });
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Train/ }));
    await waitFor(() => expect(document.querySelector(".model-training-metrics")?.textContent).toContain("0.8900"));
    expect(screen.getByText(en["model.r2InSample"])).toBeTruthy();
    expect(screen.getByText(en["model.inSampleWarningTitle"])).toBeTruthy();
    expect(screen.getByRole("button", { name: en["model.exportDataset"] })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /Train/ }).classList.contains("ant-btn-loading")).toBe(false));

    fireEvent.click(screen.getByRole("tab", { name: en["model.trainingDetails"] }));
    expect(within(screen.getByRole("tabpanel", { name: en["model.trainingDetails"] })).getByText(en["model.features"])).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: `${en["model.trainingNotices"]} (5)` }));
    const noticePicker = screen.getByRole("combobox", { name: en["model.trainingNotices"] });
    fireEvent.mouseDown(noticePicker);
    fireEvent.click(await screen.findByTitle(`3. ${en["model.unitExclusionsTitle"]}: 1`));
    expect(await screen.findByText("One row has a conflicting unit")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Train/ })).toBeTruthy();
  });
});
