// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";

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
  fireEvent.click(await screen.findByRole("radio"));
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
});
