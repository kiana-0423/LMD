// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagesForLanguage } from "../i18n/catalogues";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import { renderWithLanguage } from "./renderWithLanguage";

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

const en = messagesForLanguage("en-US");

function model(id = "model-1", name = "Friction model") {
  return {
    id,
    name,
    target: "extreme_pressure_value",
    task: "regression",
    algorithm: "ridge",
    modelVersion: "1",
    featureOrder: ["rdkit_MolWt"],
    metrics: {},
    sampleCount: 24,
    featureCount: 1,
    trainedAt: "2026-01-01",
    splitMethod: "none",
    datasetMode: "additive_component" as const,
    interpretation: "One row per additive component.",
    groupCount: 12,
    validated: true,
    featureSchemaVersion: "4",
    concentrationBasis: "none",
    usable: true
  };
}

const metrics = [
  {
    column: "extreme_pressure_value",
    labelCode: "metric.extremePressure",
    label: "Extreme pressure",
    unit: ""
  },
  {
    column: "pb_value",
    labelCode: "metric.pbValue",
    label: "PB value",
    unit: "um"
  }
];

const moleculePage = {
  items: [{ id: "mol-1", name: "ZDDP" }],
  total: 1,
  page: 1,
  pageSize: 200
};

beforeEach(async () => {
  window.localStorage.clear();
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  apiMock.listPerformanceMetrics.mockResolvedValue(metrics);
  apiMock.listMoleculePage.mockResolvedValue(moleculePage);
});

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

describe("recoverable page loading", () => {
  it("shows a model-list failure and retries it", async () => {
    apiMock.listModels
      .mockRejectedValueOnce(new Error("[sidecar.commandFailed] registry unavailable"))
      .mockResolvedValueOnce([model()]);

    renderWithLanguage(<MoleculePerformancePredictionPage />);

    expect((await screen.findAllByText(en["ui.pageFailedToLoad"])).length).toBeGreaterThan(0);
    expect(screen.getByText("registry unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(screen.getByRole("button", { name: en["ui.retry"] }));

    expect((await screen.findAllByText("Friction model")).length).toBeGreaterThan(0);
    expect(apiMock.listModels).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful training result when only the following refresh fails", async () => {
    apiMock.listModels
      .mockResolvedValueOnce([model()])
      .mockRejectedValueOnce(new Error("[sidecar.commandFailed] registry refresh failed"));
    apiMock.trainModel.mockResolvedValue({
      modelId: "model-new",
      target: "extreme_pressure_value",
      label: "Extreme pressure",
      unit: "",
      algorithm: "ridge",
      modelVersion: "1",
      trainedAt: "2026-01-02",
      sampleCount: 25,
      excludedCount: 0,
      featureCount: 1,
      featureOrder: ["rdkit_MolWt"],
      droppedFeatures: [],
      metrics: {},
      splitMethod: "none",
      groupCount: 12,
      validated: true,
      datasetMode: "additive_component",
      interpretation: "Training completed summary",
      featureSchemaVersion: "4",
      concentrationBasis: "none",
      multiAdditiveResultCount: 0,
      resultCount: 25,
      excludedForUnits: 0,
      datasetReport: { warnings: [] },
      warnings: []
    });

    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await screen.findAllByText("Friction model");
    fireEvent.click(screen.getByRole("button", { name: en["model.train"] }));

    expect(await screen.findByText("Training completed summary")).toBeTruthy();
    expect(await screen.findByText("registry refresh failed")).toBeTruthy();
    expect(screen.queryByText(en["model.trainFailed"])).toBeNull();
  });
});
