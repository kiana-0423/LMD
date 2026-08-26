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

import MoleculeScreeningPage from "../features/data-mining/MoleculeScreeningPage";

const en = messagesForLanguage("en-US");

function model(overrides: Record<string, unknown> = {}) {
  return {
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
    datasetMode: "additive_component",
    interpretation: "",
    groupCount: 12,
    validated: true,
    featureSchemaVersion: "3",
    concentrationBasis: "wt%",
    usable: true,
    ...overrides
  };
}

const molecules = [
  { id: "mol-1", name: "ZDDP" },
  { id: "mol-2", name: "MoDTC" }
];

function seed(overrides: Record<string, unknown> = {}) {
  apiMock.listModels.mockResolvedValue([model(overrides)]);
  apiMock.listMoleculePage.mockResolvedValue({
    items: molecules,
    total: molecules.length,
    page: 1,
    pageSize: 200
  });
  apiMock.listPerformanceMetrics.mockResolvedValue([
    { column: "average_friction_coefficient", label: "Average friction coefficient", unit: "" }
  ]);
}

function prediction(values: number[], skipped: unknown[] = []) {
  return {
    modelId: "model-1",
    modelName: "Friction model",
    target: "average_friction_coefficient",
    algorithm: "ridge",
    trainedAt: "2026-01-01",
    sampleCount: 24,
    datasetMode: "additive_component",
    concentrationBasis: "wt%",
    metrics: {},
    predictions: values.map((value, index) => ({
      id: molecules[index].id,
      label: molecules[index].name,
      value
    })),
    skipped
  };
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

async function runScreening() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(en["screening.run"]) }));
}

describe("screening asks for the concentration it needs", () => {
  it("shows a concentration input for a model fitted on concentrations", async () => {
    seed();

    renderWithLanguage(<MoleculeScreeningPage />);

    expect(await screen.findByText(en["concentration.massHelp"])).toBeTruthy();
    const input = screen.getByLabelText(`${en["concentration.massLabel"]} 1`);
    // Nothing is pre-filled: a ranking depends on the concentration, so LMD must not choose one.
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("refuses to rank until a concentration is entered", async () => {
    seed();
    renderWithLanguage(<MoleculeScreeningPage />);
    await screen.findByText(en["concentration.massHelp"]);

    await runScreening();

    expect(await screen.findByText(en["concentration.required"])).toBeTruthy();
    expect(apiMock.predictMoleculePerformance).not.toHaveBeenCalled();
  });

  it("refuses a concentration that is not greater than zero", async () => {
    seed();
    renderWithLanguage(<MoleculeScreeningPage />);
    const input = await screen.findByLabelText(`${en["concentration.massLabel"]} 1`);
    fireEvent.change(input, { target: { value: "0" } });

    await runScreening();

    expect(await screen.findByText(en["concentration.positive"])).toBeTruthy();
    expect(apiMock.predictMoleculePerformance).not.toHaveBeenCalled();
  });

  it("sends the entered concentration and unit for every candidate", async () => {
    seed();
    apiMock.predictMoleculePerformance.mockResolvedValue(prediction([0.05, 0.07]));
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1.5" }
    });

    await runScreening();

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalledTimes(1));
    expect(apiMock.predictMoleculePerformance).toHaveBeenCalledWith({
      modelId: "model-1",
      items: [
        { moleculeId: "mol-1", concentration: 1.5, concentrationUnit: "wt%" },
        { moleculeId: "mol-2", concentration: 1.5, concentrationUnit: "wt%" }
      ]
    });
    expect(await screen.findByText("ZDDP")).toBeTruthy();
  });

  it("ranks separately at each concentration of a sweep", async () => {
    seed();
    apiMock.predictMoleculePerformance
      .mockResolvedValueOnce(prediction([0.05, 0.07]))
      .mockResolvedValueOnce(prediction([0.04, 0.09]));
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });
    fireEvent.click(screen.getByRole("button", { name: en["screening.sweepAdd"] }));
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 2`), {
      target: { value: "3" }
    });

    await runScreening();

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalledTimes(2));
    // A ranking only means something at one concentration, so each is labelled with its own.
    expect(await screen.findByText(/1 wt%/)).toBeTruthy();
    expect(screen.getByText(/3 wt%/)).toBeTruthy();
    expect(apiMock.predictMoleculePerformance.mock.calls[1][0].items[0].concentration).toBe(3);
  });

  it("does not ask for a concentration a model was not fitted on", async () => {
    seed({ concentrationBasis: "none", featureOrder: ["rdkit_MolWt"] });
    apiMock.predictMoleculePerformance.mockResolvedValue(prediction([0.05, 0.07]));

    renderWithLanguage(<MoleculeScreeningPage />);

    expect(await screen.findByText(en["concentration.noneTitle"])).toBeTruthy();
    expect(screen.queryByLabelText(`${en["concentration.massLabel"]} 1`)).toBeNull();

    await runScreening();

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalledTimes(1));
    // Nothing invented: the request carries neither a concentration nor a unit key.
    expect(apiMock.predictMoleculePerformance.mock.calls[0][0].items[0]).toEqual({
      moleculeId: "mol-1"
    });
  });
});

describe("screening reports partial and empty outcomes", () => {
  it("names the candidates it could not rank alongside those it could", async () => {
    seed();
    apiMock.predictMoleculePerformance.mockResolvedValue(
      prediction([0.05], [{ id: "mol-2", label: "MoDTC", reason: "No descriptors calculated." }])
    );
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });

    await runScreening();

    expect(await screen.findByText(/Some candidates could not be ranked/)).toBeTruthy();
    expect(screen.getByText("MoDTC")).toBeTruthy();
    expect(screen.getByText(/No descriptors calculated\./)).toBeTruthy();
  });

  it("says plainly when nothing could be ranked", async () => {
    seed();
    apiMock.predictMoleculePerformance.mockResolvedValue(
      prediction([], [
        { id: "mol-1", label: "ZDDP", reason: "No descriptors calculated." },
        { id: "mol-2", label: "MoDTC", reason: "No descriptors calculated." }
      ])
    );
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });

    await runScreening();

    expect(await screen.findByText(en["screening.allSkippedTitle"])).toBeTruthy();
  });

  it("shows the backend's refusal rather than an empty table", async () => {
    seed();
    apiMock.predictMoleculePerformance.mockRejectedValue(
      new Error("'ZDDP' records concentrations as 'wt%', but this model was fitted on 'none'.")
    );
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });

    await runScreening();

    expect(await screen.findByText(en["screening.failed"])).toBeTruthy();
    expect(screen.getByText(/was fitted on 'none'/)).toBeTruthy();
  });
});

describe("screening never shows a ranking for inputs that changed", () => {
  it("marks the ranking stale when the concentration changes", async () => {
    seed();
    apiMock.predictMoleculePerformance.mockResolvedValue(prediction([0.05, 0.07]));
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });
    await runScreening();
    expect(await screen.findByText("ZDDP")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "2" }
    });

    // The old order was produced at 1 wt%; showing it beside "2" would misattribute it.
    expect(await screen.findByText(en["screening.staleTitle"])).toBeTruthy();
    expect(screen.queryByText("ZDDP")).toBeNull();
  });

  it("marks the ranking stale when the target property changes", async () => {
    seed();
    apiMock.listPerformanceMetrics.mockResolvedValue([
      { column: "average_friction_coefficient", label: "Average friction coefficient", unit: "" },
      { column: "wear_scar_diameter_value", label: "Wear scar diameter", unit: "um" }
    ]);
    apiMock.predictMoleculePerformance.mockResolvedValue(prediction([0.05, 0.07]));
    renderWithLanguage(<MoleculeScreeningPage />);
    fireEvent.change(await screen.findByLabelText(`${en["concentration.massLabel"]} 1`), {
      target: { value: "1" }
    });
    await runScreening();
    expect(await screen.findByText("ZDDP")).toBeTruthy();

    // Switching the target re-queries the models, which changes the signature. Ant Design puts
    // the aria-label on the wrapper and on the inner combobox, so the role narrows it.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["ui.performanceMetric"] }));
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));

    await waitFor(() => expect(screen.queryByText("ZDDP")).toBeNull());
    // Friction values must never appear under a wear-scar heading.
    expect(screen.queryByText("0.05000")).toBeNull();
  });
});
