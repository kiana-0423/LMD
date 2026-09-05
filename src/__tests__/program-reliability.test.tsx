// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagesForLanguage } from "../i18n/catalogues";
import AnalysisDesignPage from "../features/analysis-design/AnalysisDesignPage";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import MoleculeScreeningPage from "../features/data-mining/MoleculeScreeningPage";
import { renderWithLanguage } from "./renderWithLanguage";

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

const en = messagesForLanguage("en-US");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function model(id = "model-1", name = "Friction model") {
  return {
    id,
    name,
    target: "average_friction_coefficient",
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
    column: "average_friction_coefficient",
    labelCode: "metric.averageFrictionCoefficient",
    label: "Average friction coefficient",
    unit: ""
  },
  {
    column: "wear_scar_diameter_value",
    labelCode: "metric.wearScarDiameter",
    label: "Wear scar diameter",
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
      target: "average_friction_coefficient",
      label: "Average friction coefficient",
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

describe("current selections own their results", () => {
  it("does not let an abandoned analysis failure replace the newer metric", async () => {
    const abandoned = deferred<Record<string, unknown>>();
    const current = {
      status: "insufficient_data",
      message: { code: "analysis.notEnoughData", params: { required: 3, available: 0 } },
      metadata: {
        recordCount: 0,
        excludedCount: 0,
        field: "wear_scar_diameter_value",
        label: "Wear scar diameter",
        unit: "um"
      },
      series: []
    };
    for (const name of [
      "getPerformanceDistribution",
      "comparePerformanceByGroup",
      "getConcentrationPerformance",
      "getDescriptorPropertyCorrelation"
    ]) {
      apiMock[name].mockReturnValueOnce(abandoned.promise).mockResolvedValueOnce(current);
    }

    renderWithLanguage(<AnalysisDesignPage />);
    fireEvent.mouseDown(await screen.findByRole("combobox", { name: en["ui.performanceMetric"] }));
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));
    await waitFor(() => expect(apiMock.getPerformanceDistribution).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(en["ui.notEnoughDataYet"])).toBeTruthy();

    abandoned.reject(new Error("old metric failed"));
    await waitFor(() => expect(screen.queryByText("old metric failed")).toBeNull());
    expect(screen.queryByText(en["ui.analysisFailed"])).toBeNull();
  });

  it("lets the user choose which screening model produces the ranking", async () => {
    apiMock.listModels.mockResolvedValue([model(), model("model-2", "Second model")]);
    apiMock.predictMoleculePerformance.mockResolvedValue({
      modelId: "model-2",
      modelName: "Second model",
      target: "average_friction_coefficient",
      algorithm: "ridge",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      datasetMode: "additive_component",
      concentrationBasis: "none",
      metrics: {},
      predictions: [{ id: "mol-1", label: "ZDDP", value: 0.05 }],
      skipped: []
    });

    renderWithLanguage(<MoleculeScreeningPage />);
    const selector = await screen.findByRole("combobox", { name: en["model.selectModel"] });
    fireEvent.mouseDown(selector);
    fireEvent.click(await screen.findByTitle("Second model"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en["screening.run"]) }));

    await waitFor(() =>
      expect(apiMock.predictMoleculePerformance).toHaveBeenCalledWith({
        modelId: "model-2",
        items: [{ moleculeId: "mol-1" }]
      })
    );
  });
});
