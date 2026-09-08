// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function enterTauri() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
function leaveTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("production API routing", () => {
  beforeEach(() => {
    invoke.mockReset();
    enterTauri();
  });
  afterEach(() => leaveTauri());

  it("routes every write workflow to a real Tauri command", async () => {
    const api = await import("../lib/api");
    invoke.mockResolvedValue({});

    const calls: [string, () => Promise<unknown>][] = [
      ["update_base_oil", () => api.updateBaseOil("bo-1", { name: "PAO-8" })],
      ["delete_base_oil", () => api.deleteBaseOil("bo-1")],
      ["update_additive", () => api.updateAdditive("ad-1", { concentrationUnit: "wt%" })],
      ["delete_additive", () => api.deleteAdditive("ad-1")],
      ["update_formulation", () => api.updateFormulation("f-1", { name: "PAO-6 + ZDDP" })],
      ["delete_formulation", () => api.deleteFormulation("f-1")],
      ["update_experiment", () => api.updateExperimentRecord("e-1", { testType: "SRV" })],
      ["delete_experiment", () => api.deleteExperimentRecord("e-1")],
      ["update_performance_result", () => api.updatePerformanceResultRecord("r-1", {})],
      ["delete_performance_result", () => api.deletePerformanceResultRecord("r-1")],
      ["delete_molecule", () => api.deleteMolecule("m-1")],
      ["list_attachments", () => api.listAttachments("experiment", "e-1")],
      ["copy_formulation", () => api.copyFormulation("f-1", "Copy")],
      ["compare_formulations", () => api.compareFormulations(["f-1", "f-2"])],
      ["list_formulations_for_molecule", () => api.listFormulationsForMolecule("m-1")],
      ["list_molecule_files", () => api.listMoleculeFiles("m-1")],
      [
        "import_attachment",
        () =>
          api.importAttachment({
            linkedEntityType: "molecule",
            linkedEntityId: "m-1",
            sourcePath: "/tmp/a.csv"
          })
      ],
      ["export_workspace_file", () => api.exportWorkspaceFile("files/imports/a.csv", "/tmp/out.csv")],
      ["delete_attachment_record", () => api.deleteAttachmentRecord("att-1")]
    ];

    for (const [command, run] of calls) {
      invoke.mockClear();
      await run();
      expect(invoke, `${command} should reach the backend`).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][0]).toBe(command);
    }
  });

  it("routes analysis and model workflows to real commands", async () => {
    const api = await import("../lib/api");
    invoke.mockResolvedValue({ data: { status: "ok", metadata: {}, series: [], items: [], predictions: [] } });

    const calls: [string, () => Promise<unknown>][] = [
      ["train_model", () => api.trainModel({ target: "pb_value", datasetMode: "additive_component" })],
      [
        "predict_molecule_performance",
        () => api.predictMoleculePerformance({ modelId: "model-1", items: [{ moleculeId: "m-1" }] })
      ],
      [
        "predict_formulation_performance",
        () => api.predictFormulationPerformance({ modelId: "model-1", formulationIds: ["f-1"] })
      ],
      ["list_models", () => api.listModels()],
      ["export_ml_dataset", () => api.exportMlDataset("pb_value")],
      ["export_all_descriptors_csv", () => api.exportAllDescriptorsCsv()],
      ["export_molecule_library_csv", () => api.exportMoleculeLibraryCsv()]
    ];

    for (const [command, run] of calls) {
      invoke.mockClear();
      await run();
      expect(invoke, `${command} should reach the backend`).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][0]).toBe(command);
    }
  });

  it("never falls back to mock data while the Tauri runtime is present", async () => {
    const api = await import("../lib/api");
    invoke.mockRejectedValue(new Error("database unavailable"));

    // A backend failure must surface, not silently become demo data.
    await expect(api.listMoleculePage()).rejects.toThrow("database unavailable");
    await expect(api.exportAllDescriptorsCsv()).rejects.toThrow("database unavailable");
    await expect(api.listPerformanceMetrics()).rejects.toThrow("database unavailable");
  });

  it("propagates a backend failure from every new workflow", async () => {
    const api = await import("../lib/api");
    invoke.mockRejectedValue(new Error("FOREIGN KEY constraint failed"));

    // None of these may swallow the error and fall back to demo data.
    await expect(api.copyFormulation("f-1")).rejects.toThrow("FOREIGN KEY constraint failed");
    await expect(api.compareFormulations(["f-1", "f-2"])).rejects.toThrow("FOREIGN KEY constraint failed");
    await expect(api.listFormulationsForMolecule("m-1")).rejects.toThrow("FOREIGN KEY constraint failed");
    await expect(api.listMoleculeFiles("m-1")).rejects.toThrow("FOREIGN KEY constraint failed");
    await expect(api.deleteAttachmentRecord("att-1")).rejects.toThrow("FOREIGN KEY constraint failed");
    await expect(api.updateBaseOil("bo-1", {})).rejects.toThrow("FOREIGN KEY constraint failed");
  });

  it("refuses a prediction with no model named, without calling the backend", async () => {
    const api = await import("../lib/api");
    invoke.mockClear();

    // A prediction that does not name its model could silently come from one trained on other
    // semantics, and the number would look exactly as trustworthy as a correct one.
    // The refusal carries a stable code, so the interface can say it in the user's language while
    // the detail behind it stays diagnostic.
    await expect(
      api.predictMoleculePerformance({ modelId: "", items: [{ moleculeId: "m-1" }] })
    ).rejects.toThrow(/\[model\.notChosen\]/);
    await expect(api.predictFormulationPerformance({ modelId: "", formulationIds: ["f-1"] })).rejects.toThrow(
      /\[model\.notChosen\]/
    );
    // And a formulation-level request with nothing to predict on never reaches the backend.
    await expect(api.predictFormulationPerformance({ modelId: "model-1" })).rejects.toThrow(
      /\[app\.selectionRequired\]/
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to compare fewer than two formulations without calling the backend", async () => {
    const api = await import("../lib/api");
    invoke.mockClear();

    await expect(api.compareFormulations(["only-one"])).rejects.toThrow(/\[app\.selectionRequired\]/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("browser demo mode isolation", () => {
  beforeEach(() => {
    invoke.mockReset();
    leaveTauri();
    vi.resetModules();
    vi.stubEnv("VITE_DEMO_MODE", "true");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("serves demo data without ever calling a Tauri command", async () => {
    const api = await import("../lib/api");

    const page = await api.listMoleculePage({ page: 1, pageSize: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses training and prediction instead of inventing a result", async () => {
    const api = await import("../lib/api");

    await expect(api.trainModel({ target: "pb_value", datasetMode: "additive_component" })).rejects.toThrow(
      /\[app\.desktopOnly\]/
    );
    await expect(
      api.predictMoleculePerformance({ modelId: "model-1", items: [{ moleculeId: "m-1" }] })
    ).rejects.toThrow(/\[app\.desktopOnly\]/);
    await expect(
      api.predictFormulationPerformance({ modelId: "model-1", formulationIds: ["f-1"] })
    ).rejects.toThrow(/\[app\.desktopOnly\]/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

/**
 * The third state, and the one the whole separation exists for.
 *
 * Outside Tauri with no demo flag, a data call must fail. Returning demo records here is what
 * would make a broken desktop build look like a working one.
 */
describe("no runtime and no demo flag", () => {
  beforeEach(() => {
    invoke.mockReset();
    leaveTauri();
    vi.resetModules();
    vi.stubEnv("VITE_DEMO_MODE", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuses every read rather than answering with demo data", async () => {
    const api = await import("../lib/api");

    for (const call of [
      () => api.listMoleculePage({ page: 1, pageSize: 5 }),
      () => api.listBaseOils(),
      () => api.listAdditives(),
      () => api.listFormulations(),
      () => api.listExperiments(),
      () => api.getDashboardSummary()
    ]) {
      await expect(call()).rejects.toThrow(/\[app\.desktopOnly\]/);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses every write too", async () => {
    const api = await import("../lib/api");

    await expect(api.createBaseOil({ name: "PAO 6" })).rejects.toThrow(/\[app\.desktopOnly\]/);
    await expect(api.deleteBaseOil("bo-1")).rejects.toThrow(/\[app\.desktopOnly\]/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
