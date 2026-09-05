// @vitest-environment jsdom

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

import MolecularDesignPage from "../features/molecular-design/MolecularDesignPage";
import MolecularDesignSource from "../features/molecular-design/MolecularDesignPage?raw";
import CandidateTableSource from "../features/molecular-design/CandidateTable?raw";
import AssessmentPanelSource from "../features/molecular-design/AssessmentPanel?raw";
import DesignApiSource from "../lib/api/design?raw";

const en = messagesForLanguage("en-US");

function enterTauri() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
function leaveTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

const catalogue = {
  templates: [
    {
      id: "phosphate_triester",
      family: "phosphate_ester",
      label: "Phosphate triester",
      formulaSketch: "O=P(OR1)(OR2)(OR3)",
      degree: 3,
      positions: [1, 2, 3],
      chemicalClasses: ["organophosphate", "phosphate_ester", "phosphate_triester"],
      description: "",
      generatorVersion: "phosphate-template-1.0.0"
    }
  ],
  curatedSubstituents: [{ id: "n_butyl", name: "n-Butyl", smiles: "[*]CCCC" }],
  substituentSources: ["curated", "seed_substituents", "brics"],
  limits: { maxCandidates: 500, maxSeeds: 25, maxSubstituents: 200 },
  generatorVersion: "phosphate-template-1.0.0"
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    jobId: "job-1",
    name: "phosphate_triester 1",
    smilesCanonical: "CCCCOP(=O)(OCCCC)OCCCC",
    inchi: "",
    inchiKey: "KEY-TBP",
    formula: "C12H27O4P",
    molecularWeight: 266.31,
    heavyAtomCount: 17,
    templateId: "phosphate_triester",
    templateFamily: "phosphate_ester",
    chemicalClasses: ["organophosphate", "phosphate_ester", "phosphate_triester", "alkyl_phosphate"],
    substituents: [{ position: 1, smiles: "*CCCC", name: "n-Butyl", type: "linear_alkyl", elements: ["C", "H"], source: "curated", sourceId: "n_butyl" }],
    seedIds: [],
    generatorVersion: "phosphate-template-1.0.0",
    parameters: {},
    randomSeed: 42,
    request: {},
    validationStatus: "valid",
    validation: { status: "valid", findings: [{ rule: "phosphate_core", ok: true, detail: "P(=O)(O)(O)O phosphate core present." }] },
    structureSvg: "",
    existingMoleculeId: "",
    existingMoleculeName: "",
    inLibrary: false,
    promotedMoleculeId: "",
    verificationStatus: "not_verified",
    verificationNotes: "",
    notes: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    latestAssessment: null,
    synthesisFeasibility: { status: "not_assessed" },
    ...overrides
  };
}

const emptyReadiness = {
  target: "wear_scar_diameter_value",
  label: "Wear scar diameter",
  labelCode: "metric.wearScarDiameter",
  unit: "mm",
  workspace: { moleculeCount: 0, moleculesWithRealDescriptors: 0, performanceResultCount: 0, candidateCount: 0 },
  models: [],
  dataset: {
    unrestricted: { rowCount: 0, moleculeCount: 0, report: {} },
    singleAdditive: { rowCount: 0, moleculeCount: 0 },
    scopeOptions: {
      target: "wear_scar_diameter_value",
      label: "Wear scar diameter",
      unit: "mm",
      resultCount: 0,
      singleAdditiveResultCount: 0,
      multiAdditiveResultCount: 0,
      resultsWithConditions: 0,
      moleculeCount: 0,
      testTypes: []
    }
  },
  status: "generationOnly",
  reasons: [{ code: "design.noModel", params: { target: "Wear scar diameter" }, detail: "No usable model." }]
};

beforeEach(async () => {
  window.localStorage.clear();
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  apiMock.listDesignTemplates.mockResolvedValue(catalogue);
  apiMock.listPerformanceMetrics.mockResolvedValue([
    { column: "wear_scar_diameter_value", labelCode: "metric.wearScarDiameter", label: "Wear scar diameter", unit: "mm" }
  ]);
  enterTauri();
});

afterEach(() => {
  cleanup();
  leaveTauri();
  document.querySelectorAll(".ant-modal-root, .ant-message-notice-wrapper").forEach((node) => node.remove());
});

describe("Molecular Design outside the desktop application", () => {
  it("refuses plainly instead of inventing candidates", async () => {
    leaveTauri();
    renderWithLanguage(<MolecularDesignPage />);

    expect(await screen.findByText(en["design.desktopOnlyTitle"])).toBeTruthy();
    expect(apiMock.listDesignTemplates).not.toHaveBeenCalled();
    expect(apiMock.runDesignGeneration).not.toHaveBeenCalled();
  });
});

describe("Molecular Design in an empty workspace", () => {
  it("offers generation, marks prediction unavailable, and ranks nothing", async () => {
    apiMock.getDesignReadiness.mockResolvedValue(emptyReadiness);
    apiMock.listDesignCandidates.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });

    renderWithLanguage(<MolecularDesignPage />);

    // The scope statement remains available from the fixed request toolbar.
    fireEvent.click(await screen.findByRole("button", { name: en["design.scopeTitle"] }));
    expect(await screen.findByText(en["design.scopeBody"])).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(en["design.noCandidatesTitle"])).toBeTruthy();
    // Generation requires a template or seeds, independently of model availability.
    const generate = await screen.findByRole("button", { name: en["design.generate"] });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    // Without a chosen metric the readiness panel asks for one rather than showing a status.
    // The prompt appears in the readiness card and again in the assessment card.
    expect(screen.getAllByText(en["design.readinessChooseTarget"]).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(en["design.assessSelected"], { exact: false })).toBeNull();
    // No predicted value, score, or ranking is rendered anywhere.
    expect(document.body.textContent).not.toMatch(/\d\.\d{5}/);
  });

  it("says prediction is unavailable, in words, once a metric is chosen and no model exists", async () => {
    apiMock.getDesignReadiness.mockResolvedValue(emptyReadiness);
    apiMock.listDesignCandidates.mockResolvedValue({ items: [candidate()], total: 1, page: 1, pageSize: 200 });

    renderWithLanguage(<MolecularDesignPage />);
    await screen.findByRole("button", { name: en["design.scopeTitle"] });

    // Choosing the metric triggers the readiness read for it.
    fireEvent.click(screen.getByRole("tab", { name: en["design.dimensionTarget"] }));
    const metricSelect = screen.getByRole("combobox", { name: en["design.targetMetric"] });
    fireEvent.mouseDown(metricSelect);
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));

    await waitFor(() => expect(apiMock.getDesignReadiness).toHaveBeenLastCalledWith("wear_scar_diameter_value"));
    expect(await screen.findByText(en["design.readinessGenerationOnly"])).toBeTruthy();
    expect(screen.getByText(en["design.predictionUnavailableTitle"])).toBeTruthy();
    // The stored candidate is listed with its library status, and without any number beside it.
    expect(screen.getByText("phosphate_triester 1")).toBeTruthy();
    expect(screen.getByText(en["design.notInWorkspace"])).toBeTruthy();
    expect(screen.getByText(en["design.notAssessed"])).toBeTruthy();
    expect(apiMock.assessDesignCandidates).not.toHaveBeenCalled();
  });
});

describe("request categories without positional paging", () => {
  async function chooseTemplate() {
    fireEvent.mouseDown(await screen.findByRole("combobox", { name: en["design.template"] }));
    fireEvent.click(await screen.findByText(/^Phosphate triester/));
  }

  it("can remove the template and submit seeds with independent whole-molecule limits", async () => {
    apiMock.runDesignGeneration.mockRejectedValue(new Error("[sidecar.commandFailed] test failure"));
    renderWithLanguage(<MolecularDesignPage />);
    await chooseTemplate();
    fireEvent.click(screen.getByRole("tab", { name: en["design.substituentRules"] }));
    fireEvent.change(screen.getByRole("spinbutton", { name: en["design.maxHeavyAtoms"] }), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.template"] }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["design.template"] }));
    fireEvent.click(await screen.findByTitle(en["design.noTemplate"]));
    fireEvent.click(screen.getByRole("tab", { name: en["design.candidateConstraints"] }));
    expect((screen.getByRole("spinbutton", { name: en["design.maxHeavyAtoms"] }) as HTMLInputElement).value).toBe("60");
    fireEvent.change(screen.getByRole("spinbutton", { name: en["design.maxHeavyAtoms"] }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.seeds"] }));
    fireEvent.click(screen.getByRole("button", { name: en["design.addSeed"] }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["design.seedSource"] }));
    fireEvent.click(await screen.findByTitle(en["design.seedFromInput"]));
    fireEvent.change(screen.getByRole("textbox", { name: en["design.seedSmiles"] }), { target: { value: "CCCOCC" } });
    fireEvent.click(screen.getByRole("button", { name: en["design.generate"] }));
    await waitFor(() => expect(apiMock.runDesignGeneration).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "",
      constraints: expect.objectContaining({ maxHeavyAtoms: 18 }),
      candidateConstraints: expect.objectContaining({ maxHeavyAtoms: 6 }),
      substituentSources: ["brics"],
      seeds: [expect.objectContaining({ source: "user", smiles: "CCCOCC" })]
    })));
  });

  it("keeps fields across categories and submits the same three independent dimensions", async () => {
    apiMock.runDesignGeneration.mockRejectedValue(new Error("[sidecar.commandFailed] test failure"));
    renderWithLanguage(<MolecularDesignPage />);
    await chooseTemplate();
    fireEvent.change(screen.getByRole("textbox", { name: en["design.requestName"] }), { target: { value: "Phosphate series" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.substituentRules"] }));
    fireEvent.change(screen.getByRole("spinbutton", { name: en["design.maxHeavyAtoms"] }), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.generationSettings"] }));
    fireEvent.change(screen.getByRole("spinbutton", { name: en["design.maxCandidates"] }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.dimensionTarget"] }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["design.targetMetric"] }));
    fireEvent.click(await screen.findByTitle("Wear scar diameter"));
    fireEvent.click(screen.getByRole("tab", { name: en["design.dimensionContext"] }));
    fireEvent.change(screen.getByRole("spinbutton", { name: en["design.conditionTemperature"] }), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("tab", { name: en["design.substituentRules"] }));
    expect((screen.getByRole("spinbutton", { name: en["design.maxHeavyAtoms"] }) as HTMLInputElement).value).toBe("18");
    const generate = screen.getByRole("button", { name: en["design.generate"] });
    const panel = generate.closest(".workspace-fixed-panel");
    expect(panel).not.toBeNull();
    expect(panel?.querySelector(".workspace-pagination")).toBeNull();
    fireEvent.click(generate);
    await waitFor(() => expect(apiMock.runDesignGeneration).toHaveBeenCalledWith(expect.objectContaining({
      name: "Phosphate series",
      templateId: "phosphate_triester",
      constraints: expect.objectContaining({ maxHeavyAtoms: 18 }),
      maxCandidates: 12,
      targetMetric: "wear_scar_diameter_value",
      context: expect.objectContaining({ temperatureValue: 75, temperatureUnit: "°C" })
    })));
  });

  it("edits one seed at a time and keeps earlier seeds when adding and removing another", async () => {
    renderWithLanguage(<MolecularDesignPage />);
    await chooseTemplate();
    fireEvent.click(screen.getByRole("tab", { name: en["design.substituentSources"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: en["design.sourceBrics"] }));
    fireEvent.click(screen.getByRole("tab", { name: en["design.seeds"] }));
    fireEvent.click(screen.getByRole("button", { name: en["design.addSeed"] }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: en["design.seedSource"] }));
    fireEvent.click(await screen.findByTitle(en["design.seedFromInput"]));
    const smiles = "CCOP(=O)(OCC)OCC";
    fireEvent.change(screen.getByRole("textbox", { name: en["design.seedSmiles"] }), { target: { value: smiles } });
    fireEvent.click(screen.getByRole("button", { name: en["design.addSeed"] }));
    expect(screen.getAllByRole("combobox", { name: en["design.seedSource"] })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: en["model.candidateRemove"] }));
    expect((screen.getByRole("textbox", { name: en["design.seedSmiles"] }) as HTMLInputElement).value).toBe(smiles);
  });
});

describe("candidate and library separation", () => {
  it("lists a candidate that matches a stored molecule as already in the library, not as new", async () => {
    apiMock.getDesignReadiness.mockResolvedValue(emptyReadiness);
    apiMock.listDesignCandidates.mockResolvedValue({
      items: [candidate({ existingMoleculeId: "mol-1", existingMoleculeName: "Tributyl phosphate", inLibrary: true })],
      total: 1,
      page: 1,
      pageSize: 200
    });

    renderWithLanguage(<MolecularDesignPage />);

    expect(await screen.findByText(en["design.alreadyInLibrary"], { exact: false })).toBeTruthy();
    expect(screen.getByText("Tributyl phosphate")).toBeTruthy();
    expect(screen.queryByText(en["design.notInWorkspace"])).toBeNull();
  });

  it("only enters the library through the explicit promotion command", () => {
    // The page never calls the molecule save API itself; promotion is one backend command that
    // records the origin and the link back to the candidate.
    expect(MolecularDesignSource).toContain("promoteDesignCandidate");
    expect(MolecularDesignSource).not.toContain("saveMoleculeWithRequiredDescriptors");
    expect(MolecularDesignSource).not.toContain("importNewMolecule");
    expect(DesignApiSource).toContain('"promote_design_candidate"');
  });
});

describe("no fabricated results", () => {
  it("never sorts candidates by a predicted value and never invents a score", () => {
    for (const source of [MolecularDesignSource, CandidateTableSource, AssessmentPanelSource]) {
      expect(source).not.toMatch(/\.sort\(\s*\([^)]*\)\s*=>[^)]*predictedValue/);
      expect(source).not.toMatch(/predictionScore|confidence\s*[:=]\s*\d|probability/);
      expect(source).not.toMatch(/value\s*:\s*0\.\d{2,}/);
    }
    // Synthesis feasibility is named as not assessed, never computed.
    expect(AssessmentPanelSource).toContain("design.synthesisNotAssessedHelp");
    expect(DesignApiSource).toContain('synthesisFeasibility: { status: "not_assessed" }');
  });

  it("keeps the three request dimensions apart in the payload", () => {
    expect(DesignApiSource).toContain("targetFunction: request.targetFunction");
    expect(DesignApiSource).toContain("context: request.context");
    expect(DesignApiSource).toContain("templateId: request.templateId");
  });
});
