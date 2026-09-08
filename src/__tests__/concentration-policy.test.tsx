// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";
import {
  buildConcentration,
  buildConcentrations,
  concentrationPolicy,
  readBasis
} from "../lib/concentrationPolicy";

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import FormulationPredictionPage from "../features/data-mining/FormulationPredictionPage";

const en = messagesForLanguage("en-US");

/**
 * A model's basis decides what a prediction screen may send.
 *
 * Three bases, three prediction surfaces (molecule, screening, aggregate candidate), and the
 * payload differs in all nine combinations. Before this, every surface handled `wt%` and silently
 * sent a weight-percent unit for the other two — which the backend correctly refused, with a
 * message about the data rather than about the interface that built the request.
 */

describe("the concentration policy", () => {
  it("refuses a basis this build does not define rather than guessing", () => {
    expect(readBasis("wt%")).toBe("wt%");
    expect(readBasis("unrecorded")).toBe("unrecorded");
    expect(readBasis("none")).toBe("none");
    for (const unknown of ["", "WT%", "mol%", "percent", undefined]) {
      expect(readBasis(unknown)).toBeUndefined();
      expect(concentrationPolicy(unknown)).toBeUndefined();
    }
  });

  it("sends a value and a unit for a weight-percent model", () => {
    const policy = concentrationPolicy("wt%")!;
    expect(policy.needsValue).toBe(true);
    expect(policy.needsUnit).toBe(true);
    expect(buildConcentration(policy, { value: 1.5, unit: "ppm" })).toEqual({
      ok: true,
      payload: { concentration: 1.5, concentrationUnit: "ppm" }
    });
  });

  it("sends a value and no unit key at all for a unit-less model", () => {
    const policy = concentrationPolicy("unrecorded")!;
    expect(policy.needsValue).toBe(true);
    expect(policy.needsUnit).toBe(false);
    const built = buildConcentration(policy, { value: 1.5, unit: "wt%" });
    expect(built).toEqual({ ok: true, payload: { concentration: 1.5 } });
    // Not an empty string, and not "wt%": the key is absent, which is what "no unit was
    // recorded" means to the Rust reader.
    expect(built.ok && "concentrationUnit" in built.payload).toBe(false);
  });

  it("sends neither a value nor a unit for a model fitted without concentrations", () => {
    const policy = concentrationPolicy("none")!;
    expect(policy.needsValue).toBe(false);
    expect(policy.needsUnit).toBe(false);
    // Whatever is in the state, nothing is sent. A `none` model must not receive a number.
    expect(buildConcentration(policy, { value: 7, unit: "wt%" })).toEqual({ ok: true, payload: {} });
    expect(buildConcentration(policy, { value: null })).toEqual({ ok: true, payload: {} });
  });

  it.each(["wt%", "unrecorded"] as const)("refuses a missing value for a %s model", (basis) => {
    const policy = concentrationPolicy(basis)!;
    expect(buildConcentration(policy, { value: null, unit: "wt%" })).toEqual({
      ok: false,
      messageKey: "concentration.required"
    });
  });

  it.each(["wt%", "unrecorded"] as const)(
    "refuses a non-positive or non-finite value for a %s model",
    (basis) => {
      const policy = concentrationPolicy(basis)!;
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(buildConcentration(policy, { value, unit: "wt%" })).toEqual({
          ok: false,
          messageKey: "concentration.positive"
        });
      }
    }
  );

  it("refuses a weight-percent value with no unit chosen", () => {
    const policy = concentrationPolicy("wt%")!;
    expect(buildConcentration(policy, { value: 1, unit: "  " })).toEqual({
      ok: false,
      messageKey: "concentration.unitRequired"
    });
  });

  it("reports the first bad entry rather than a half-built list", () => {
    const policy = concentrationPolicy("wt%")!;
    expect(
      buildConcentrations(policy, [
        { value: 1, unit: "wt%" },
        { value: null, unit: "wt%" },
        { value: 2, unit: "wt%" }
      ])
    ).toEqual({ ok: false, messageKey: "concentration.required" });
  });
});

// --- the three prediction surfaces --------------------------------------------------------------

function model(basis: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "model-1",
    name: `Model on ${basis}`,
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
    datasetMode: "additive_component",
    interpretation: "",
    groupCount: 12,
    validated: true,
    featureSchemaVersion: "4",
    concentrationBasis: basis,
    usable: true,
    ...overrides
  };
}

const RESULT = {
  modelId: "model-1",
  modelName: "Model",
  target: "extreme_pressure_value",
  algorithm: "ridge",
  trainedAt: "2026-01-01",
  sampleCount: 24,
  datasetMode: "additive_component",
  concentrationBasis: "wt%",
  metrics: {},
  predictions: [{ id: "mol-1", label: "ZDDP", value: 0.061 }],
  skipped: []
};

/** The first target each page offers; a model for any other target is correctly refused. */
const PAGE_TARGET = {
  additive_component: "extreme_pressure_value",
  formulation_aggregate: "average_friction_coefficient"
} as const;

function seed(basis: string, mode: "additive_component" | "formulation_aggregate" = "additive_component") {
  apiMock.listPerformanceMetrics.mockResolvedValue([
    {
      column: "extreme_pressure_value",
      labelCode: "metric.averageFrictionCoefficient",
      label: "Average friction coefficient",
      unit: ""
    },
    {
      column: "average_friction_coefficient",
      labelCode: "metric.initialOxidationTemperature",
      label: "Initial oxidation temperature",
      unit: "C"
    }
  ]);
  apiMock.listModels.mockResolvedValue([
    model(basis, { datasetMode: mode, target: PAGE_TARGET[mode] })
  ]);
  apiMock.listMoleculePage.mockResolvedValue({
    items: [{ id: "mol-1", name: "ZDDP" }],
    total: 1,
    page: 1,
    pageSize: 200
  });
  apiMock.listFormulations.mockResolvedValue([{ id: "form-1", name: "Blend A" }]);
  apiMock.listBaseOils.mockResolvedValue([{ id: "oil-1", name: "PAO-6" }]);
  apiMock.predictMoleculePerformance.mockResolvedValue(RESULT);
  apiMock.predictFormulationPerformance.mockResolvedValue({ ...RESULT, datasetMode: mode });
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

async function chooseMolecule() {
  fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));
  const picker = await screen.findByRole("combobox", { name: en["model.selectMoleculesToPredict"] });
  fireEvent.mouseDown(picker);
  fireEvent.click(await screen.findByTitle("ZDDP"));
}

describe("molecule prediction sends what the model's basis allows", () => {
  it("sends the value and the chosen unit for a weight-percent model", async () => {
    seed("wt%");
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await chooseMolecule();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2.5" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["model.concentrationUnit"] }));
    fireEvent.click(await screen.findByTitle("ppm"));
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
    expect(apiMock.predictMoleculePerformance).toHaveBeenCalledWith({
      modelId: "model-1",
      items: [{ moleculeId: "mol-1", concentration: 2.5, concentrationUnit: "ppm" }]
    });
  });

  it("sends the value with no unit for a unit-less model, and offers no unit picker", async () => {
    seed("unrecorded");
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await chooseMolecule();

    // The field is labelled as unit-less, and there is no unit to choose.
    expect(screen.getByText(en["concentration.unrecordedHelp"])).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: en["model.concentrationUnit"] })).toBeNull();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
    expect(apiMock.predictMoleculePerformance).toHaveBeenCalledWith({
      modelId: "model-1",
      items: [{ moleculeId: "mol-1", concentration: 2.5 }]
    });
  });

  it("sends neither value nor unit for a model fitted without concentrations", async () => {
    seed("none");
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await chooseMolecule();

    // No number field at all: there is nothing here that could invent a concentration.
    expect(screen.getByText(en["concentration.noneHelp"])).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
    expect(apiMock.predictMoleculePerformance).toHaveBeenCalledWith({
      modelId: "model-1",
      items: [{ moleculeId: "mol-1" }]
    });
  });

  it("refuses to predict at all when a required concentration is missing", async () => {
    seed("wt%");
    renderWithLanguage(<MoleculePerformancePredictionPage />);
    await chooseMolecule();

    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    expect(await screen.findByText(en["concentration.required"])).toBeTruthy();
    expect(apiMock.predictMoleculePerformance).not.toHaveBeenCalled();
  });
});

describe("aggregate candidates follow the same policy", () => {
  async function addCandidate(componentLabel: string, buttonKey: "model.candidateAddAdditive" | "model.candidateAddBaseOil") {
    fireEvent.click(screen.getByRole("button", { name: en[buttonKey] }));
    const pickers = await screen.findAllByRole("combobox", { name: en["model.candidateComponent"] });
    const picker = pickers[pickers.length - 1];
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByTitle(componentLabel));
  }

  it("sends concentrations and units for a weight-percent model", async () => {
    seed("wt%", "formulation_aggregate");
    renderWithLanguage(<FormulationPredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));

    await addCandidate("ZDDP", "model.candidateAddAdditive");
    await addCandidate("PAO-6", "model.candidateAddBaseOil");
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "4" } });
    fireEvent.change(numbers[1], { target: { value: "96" } });
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictFormulationPerformance).toHaveBeenCalled());
    expect(apiMock.predictFormulationPerformance).toHaveBeenCalledWith({
      modelId: "model-1",
      formulationIds: [],
      candidates: [
        {
          name: undefined,
          additives: [{ moleculeId: "mol-1", concentration: 4, concentrationUnit: "wt%" }],
          baseOils: [{ baseOilId: "oil-1", concentration: 96, concentrationUnit: "wt%" }]
        }
      ]
    });
  });

  it("sends unit-less values for a unit-less model", async () => {
    seed("unrecorded", "formulation_aggregate");
    renderWithLanguage(<FormulationPredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));

    await addCandidate("ZDDP", "model.candidateAddAdditive");
    await addCandidate("PAO-6", "model.candidateAddBaseOil");
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "4" } });
    fireEvent.change(numbers[1], { target: { value: "96" } });
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictFormulationPerformance).toHaveBeenCalled());
    const sent = apiMock.predictFormulationPerformance.mock.calls[0][0];
    expect(sent.candidates[0].additives).toEqual([{ moleculeId: "mol-1", concentration: 4 }]);
    expect(sent.candidates[0].baseOils).toEqual([{ baseOilId: "oil-1", concentration: 96 }]);
  });

  it("builds a candidate from component ids alone for a model fitted without concentrations", async () => {
    seed("none", "formulation_aggregate");
    renderWithLanguage(<FormulationPredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));

    await addCandidate("ZDDP", "model.candidateAddAdditive");
    await addCandidate("PAO-6", "model.candidateAddBaseOil");
    // No concentration fields exist to fill in, so none can be invented.
    expect(screen.queryByRole("spinbutton")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    await waitFor(() => expect(apiMock.predictFormulationPerformance).toHaveBeenCalled());
    const sent = apiMock.predictFormulationPerformance.mock.calls[0][0];
    expect(sent.candidates[0].additives).toEqual([{ moleculeId: "mol-1" }]);
    expect(sent.candidates[0].baseOils).toEqual([{ baseOilId: "oil-1" }]);
  });

  it("refuses a candidate whose required concentration is blank", async () => {
    seed("wt%", "formulation_aggregate");
    renderWithLanguage(<FormulationPredictionPage />);
    fireEvent.click(screen.getByRole("tab", { name: en["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: en["model.predictTitle"] }));

    await addCandidate("ZDDP", "model.candidateAddAdditive");
    fireEvent.click(screen.getByRole("button", { name: en["model.predict"] }));

    expect(await screen.findByText(en["concentration.required"])).toBeTruthy();
    expect(apiMock.predictFormulationPerformance).not.toHaveBeenCalled();
  });
});
