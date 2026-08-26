import { describe, expect, it } from "vitest";

// Vite inlines these at transform time, so the test reads real source without Node filesystem
// types. Each assertion checks a structural property that a unit test of behaviour cannot.
import FormulationUsageTable from "../features/molecules/components/FormulationUsageTable?raw";
import MoleculeViewer3D from "../features/molecules/components/MoleculeViewer3D?raw";
import MoleculeFilesPanel from "../features/molecules/components/MoleculeFilesPanel?raw";
import ModelWorkbench from "../features/data-mining/ModelWorkbench?raw";
import MoleculeScreeningPage from "../features/data-mining/MoleculeScreeningPage?raw";
import MoleculePerformancePage from "../features/data-mining/MoleculePerformancePredictionPage?raw";
import FormulationPredictionPage from "../features/data-mining/FormulationPredictionPage?raw";
import KetcherTranslationBridge from "../features/molecule-sketcher/KetcherTranslationBridge?raw";

/**
 * The browser-demo modules, by file name.
 *
 * They all live under `src/lib/demo/` now, reachable only through the guarded dynamic import in
 * `lib/tauri.ts`. A production component importing one directly would put fabricated records back
 * into the desktop bundle, which is what these assertions exist to prevent.
 */
const DEMO_MODULES = ["api.mock", "mockData", "mockStructure", "demo/adapter"];

function importsDemoModule(source: string) {
  return DEMO_MODULES.some((module) => new RegExp(`from\\s+["'][^"']*${module}["']`).test(source));
}

describe("Related Formulations", () => {
  it("renders only what the API returned", () => {
    // Its rows come from state fed by the command, never from a literal.
    expect(FormulationUsageTable).toContain("listFormulationsForMolecule");
    expect(FormulationUsageTable).toContain("dataSource={rows}");
    expect(FormulationUsageTable).not.toMatch(/const\s+rows\s*(:[^=]+)?=\s*\[\s*\{/);
  });

  it("carries no fixed formulation name, count, or performance value", () => {
    for (const fabricated of ["PAO-6 + ZDDP", "usage-1", "0.082"]) {
      expect(FormulationUsageTable).not.toContain(fabricated);
    }
  });

  it("marks database values as non-translatable", () => {
    expect(FormulationUsageTable).toContain('translate="no"');
  });
});

describe("3D rendering", () => {
  it("never imports a browser-demo module", () => {
    expect(importsDemoModule(MoleculeViewer3D)).toBe(false);
    expect(MoleculeViewer3D).not.toContain("buildMock3dMolBlock");
  });

  it("asks the backend to persist by molecule id rather than sending a SMILES string", () => {
    expect(MoleculeViewer3D).toContain("generateMolecule3d(molecule.id)");
  });

  it("refuses a structure block with no readable coordinates", () => {
    expect(MoleculeViewer3D).toContain("parseStructure(block).atoms.length");
    expect(MoleculeViewer3D).toContain("viewer3d.noCoordinates");
  });
});

describe("Files & Attachments", () => {
  it("renders only backend-supplied paths", () => {
    expect(MoleculeFilesPanel).toContain("listMoleculeFiles");
    expect(MoleculeFilesPanel).toContain("relativePath");
    for (const fabricated of ["mock-source.csv", "mock-report.pdf", "files/imports/mock"]) {
      expect(MoleculeFilesPanel).not.toContain(fabricated);
    }
  });

  it("never imports a browser-demo module", () => {
    expect(importsDemoModule(MoleculeFilesPanel)).toBe(false);
  });

  it("confirms before a destructive delete", () => {
    expect(MoleculeFilesPanel).toContain("Modal.confirm");
    expect(MoleculeFilesPanel).toContain("files.deleteConfirmBody");
  });
});

describe("model pages", () => {
  it("use no fixed prediction values", () => {
    for (const source of [ModelWorkbench, MoleculeScreeningPage]) {
      expect(importsDemoModule(source)).toBe(false);
      // A literal prediction score or a hard-coded candidate has no place here.
      expect(source).not.toMatch(/prediction_score/);
      expect(source).not.toMatch(/predictionScore\s*:\s*[\d.]/);
      expect(source).not.toMatch(/value\s*:\s*0\.\d{2,}/);
    }
  });

  it("state plainly that scores describe the user's own workspace", () => {
    expect(ModelWorkbench).toContain("model.workspaceOnlyBody");
    expect(ModelWorkbench).toContain("model.inSampleWarningTitle");
  });

  it("do not claim to generate molecules", () => {
    for (const source of [ModelWorkbench, MoleculeScreeningPage]) {
      expect(source).not.toContain("Molecule Design");
      expect(source).not.toContain("candidate generation");
    }
    expect(MoleculeScreeningPage).toContain("screening.rankingOnlyBody");
  });
});

describe("prediction semantics", () => {
  it("locks each prediction page to one dataset mode", () => {
    // A page that could switch mode would have to switch its whole prediction form with it; these
    // pass the mode down instead, so the controls always match the model being asked.
    expect(MoleculePerformancePage).toContain('datasetMode="additive_component"');
    expect(FormulationPredictionPage).toContain('datasetMode="formulation_aggregate"');
  });

  it("asks a formulation-level model about formulations, never about a single molecule", () => {
    expect(ModelWorkbench).toContain("predictFormulationPerformance");
    expect(ModelWorkbench).toContain("predictMoleculePerformance");
    // The two pickers are mutually exclusive, and each is gated on a readable concentration
    // basis: a model whose basis this build cannot read gets no prediction controls at all.
    expect(ModelWorkbench).toContain("aggregate && policy ? (");
    expect(ModelWorkbench).toContain("!aggregate && policy ? (");
    expect(ModelWorkbench).toContain("model.selectFormulations");
    expect(ModelWorkbench).toContain("model.candidateTitle");
  });

  it("names the model a prediction came from rather than assuming the newest", () => {
    expect(ModelWorkbench).toContain("selectedModelId");
    expect(ModelWorkbench).toContain('rowSelection={{');
    expect(ModelWorkbench).toContain("model.selectModelFirst");
  });

  it("screens with molecule-level models only", () => {
    expect(MoleculeScreeningPage).toContain('listModels(target, "additive_component")');
    // A model from an older feature definition cannot answer, so it is not offered.
    expect(MoleculeScreeningPage).toContain("item.usable");
    expect(MoleculeScreeningPage).not.toContain("formulation_aggregate");
  });
});

describe("translation bridge scope", () => {
  it("runs only inside third-party Ketcher chrome", () => {
    expect(KetcherTranslationBridge).toContain("data-i18n-ketcher");
    // Every string LMD renders itself goes through the key catalogue, so no page opts in any more.
    expect(KetcherTranslationBridge).not.toContain("data-i18n-legacy");
    // It must not reach for the whole document or the application root either.
    expect(KetcherTranslationBridge).not.toContain('getElementById("root")');
    expect(KetcherTranslationBridge).not.toContain("observer.observe(document.body");
  });
});


describe("bundle separation", () => {
  it("keeps every catalogue out of the modules a screen imports", () => {
    // `src/i18n/catalogues.ts` pulls all three locales in at once. It exists for the coverage
    // checks; a screen importing it would put Chinese and Japanese back into the initial chunk and
    // undo the split.
    const sources = import.meta.glob("../{features,layouts,components,lib}/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true
    }) as Record<string, string>;

    const offenders = Object.entries(sources)
      .filter(([, source]) => /from\s+["'][^"']*i18n\/catalogues["']/.test(source))
      .map(([file]) => file);

    expect(offenders, "these modules would pull every locale into their chunk").toEqual([]);
  });

  it("reaches demo data through exactly one guarded door", () => {
    const sources = import.meta.glob("../{features,layouts,components,routes}/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true
    }) as Record<string, string>;

    const offenders = Object.entries(sources)
      .filter(([, source]) => DEMO_MODULES.some((module) => source.includes(`/${module}`)))
      .map(([file]) => file);

    expect(offenders, "only lib/tauri.ts may reach the demo adapter").toEqual([]);
  });
});
