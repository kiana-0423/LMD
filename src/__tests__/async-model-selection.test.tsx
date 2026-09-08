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

/**
 * A slow answer to a question the user has stopped asking.
 *
 * Switching target starts a new model query while the previous one is still in flight. Networks
 * and SQLite do not promise an order, so the first request can land last — and then the models
 * trained for the target the user just left are listed, selected, and predicted with, under the
 * name of the target they are now looking at. Nothing about the resulting number would look
 * wrong.
 *
 * These tests hold the first response open, let the second land, and only then release the first.
 */

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const METRICS = [
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

function model(id: string, target: string, name: string) {
  return {
    id,
    name,
    target,
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
    interpretation: "",
    groupCount: 12,
    validated: true,
    featureSchemaVersion: "4",
    concentrationBasis: "none",
    usable: true
  };
}

const FRICTION_MODEL = model("model-friction", "extreme_pressure_value", "Friction model");
const WEAR_MODEL = model("model-wear", "pb_value", "Wear model");

beforeEach(async () => {
  window.localStorage.clear();
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
  apiMock.listMoleculePage.mockResolvedValue({
    items: [{ id: "mol-1", name: "ZDDP" }],
    total: 1,
    page: 1,
    pageSize: 200
  });
});

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

/** Switches the target select to the named option. */
async function switchTarget(label: string) {
  fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
  fireEvent.click(await screen.findByTitle(label));
}

describe("an older model list cannot overwrite the current target's", () => {
  it("discards a first response that arrives after the second", async () => {
    const first = deferred<unknown[]>();
    apiMock.listModels.mockReturnValueOnce(first.promise).mockResolvedValueOnce([WEAR_MODEL]);

    renderWithLanguage(<MoleculePerformancePredictionPage />);
    // The first request is still open, so nothing is listed and nothing can be chosen.
    expect(await screen.findByText(en["model.modelsLoading"])).toBeTruthy();

    await switchTarget("PB value");
    await waitFor(() => expect(screen.getAllByText("Wear model").length).toBeGreaterThan(0));

    // Now the abandoned request answers, with the previous target's models.
    first.resolve([FRICTION_MODEL]);
    await waitFor(() => expect(apiMock.listModels).toHaveBeenCalledTimes(2));

    // It must not appear, and must not be selectable.
    await waitFor(() => expect(screen.queryByText("Friction model")).toBeNull());
    expect(screen.getByText("Wear model")).toBeTruthy();
  });

  it("clears the previous target's models before the new list arrives", async () => {
    const second = deferred<unknown[]>();
    apiMock.listModels.mockResolvedValueOnce([FRICTION_MODEL]).mockReturnValueOnce(second.promise);

    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await waitFor(() => expect(screen.getByText("Friction model")).toBeTruthy());

    await switchTarget("PB value");

    // The friction model is gone the moment the target changes, not when the new list lands.
    // Leaving it visible would offer a choice that is already wrong.
    await waitFor(() => expect(screen.queryByText("Friction model")).toBeNull());
    expect(screen.getByText(en["model.modelsLoading"])).toBeTruthy();

    second.resolve([WEAR_MODEL]);
    await waitFor(() => expect(screen.getByText("Wear model")).toBeTruthy());
  });

  it("disables prediction while the model list is loading", async () => {
    const pending = deferred<unknown[]>();
    apiMock.listModels.mockReturnValue(pending.promise);

    renderWithLanguage(<MoleculePerformancePredictionPage />);

    await screen.findByText(en["model.modelsLoading"]);
    // There is no predict button at all while there is no model to predict with.
    expect(screen.queryByRole("button", { name: en["model.predict"] })).toBeNull();

    pending.resolve([FRICTION_MODEL]);
    await waitFor(() => expect(screen.getByText("Friction model")).toBeTruthy());
  });

  it("discards a prediction whose request belonged to an earlier target", async () => {
    apiMock.listModels.mockResolvedValueOnce([FRICTION_MODEL]).mockResolvedValueOnce([WEAR_MODEL]);
    const prediction = deferred<Record<string, unknown>>();
    apiMock.predictMoleculePerformance.mockReturnValue(prediction.promise);

    renderWithLanguage(<MoleculePerformancePredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));
    const picker = await screen.findByRole("combobox", {
      name: en["model.selectMoleculesToPredict"]
    });
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByTitle("ZDDP"));
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));
    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());

    // The user moves on while the prediction is still running.
    await switchTarget("PB value");
    await waitFor(() => expect(screen.getByText("Wear model")).toBeTruthy());

    prediction.resolve({
      modelId: "model-friction",
      modelName: "Friction model",
      target: "extreme_pressure_value",
      algorithm: "ridge",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      datasetMode: "additive_component",
      concentrationBasis: "none",
      metrics: {},
      predictions: [{ id: "mol-1", label: "ZDDP", value: 0.06123 }],
      skipped: []
    });

    // A friction figure must never be rendered under a wear-scar heading.
    await waitFor(() => expect(screen.queryByText("0.06123")).toBeNull());
  });

  it("refuses to predict with a model that does not match the current target", async () => {
    // The model list is for the current target, but the model itself names another one — the
    // shape a stale response leaves behind if it ever slipped past the version check.
    apiMock.listModels.mockResolvedValue([model("model-mismatch", "pb_value", "Wear model")]);

    renderWithLanguage(<MoleculePerformancePredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));
    const picker = await screen.findByRole("combobox", {
      name: en["model.selectMoleculesToPredict"]
    });
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByTitle("ZDDP"));
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    expect(await screen.findByText(en["model.selectionMismatch"])).toBeTruthy();
    expect(apiMock.predictMoleculePerformance).not.toHaveBeenCalled();
  });
});
