// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormulationUsageTable from "../features/molecules/components/FormulationUsageTable";
import MoleculeFilesPanel from "../features/molecules/components/MoleculeFilesPanel";
import MoleculeViewer3D from "../features/molecules/components/MoleculeViewer3D";
import MoleculeDetailDrawer from "../features/molecules/MoleculeDetailDrawer";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";
import { renderWithLanguage } from "./renderWithLanguage";
import { LanguageProvider } from "../i18n/LanguageContext";
import type { Molecule } from "../types";

// Built from the real API contract, so a component that calls a function this test never thought
// about gets a working stub instead of an unhandled rejection.
const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

const chooseFile = vi.hoisted(() => vi.fn());
const chooseSaveDestination = vi.hoisted(() => vi.fn());
vi.mock("../lib/dialogs", () => ({
  chooseFile,
  chooseSaveDestination,
  chooseFolder: vi.fn(),
  nativeDialogsAvailable: () => true,
  TABLE_FILTERS: [],
  ATTACHMENT_FILTERS: []
}));

const mockStructureModule = vi.hoisted(() => ({
  buildMock3dMolBlock: vi.fn(() => "MOCK"),
  buildMockSdfBlock: vi.fn(() => "MOCK"),
  buildMockPdbBlock: vi.fn(() => "MOCK")
}));
vi.mock("../lib/mockStructure", () => mockStructureModule);

function molecule(extra: Partial<Molecule> = {}): Molecule {
  return {
    id: "mol-1",
    name: "ZDDP-Chain-Ester-01",
    aliases: "",
    smilesRaw: "CCO",
    smilesCanonical: "CCO",
    inchi: "",
    inchiKey: "",
    formula: "C2H6O",
    molecularWeight: 46.069,
    category: "additive",
    additiveFunctionTags: [],
    tags: [],
    molfile: "",
    duplicateOf: "",
    importMode: "manual_save",
    source: "",
    structureSvgPath: "",
    structureSvg: "",
    molFilePath: "",
    sdfFilePath: "",
    pdbFilePath: "",
    molBlock: "",
    sdfBlock: "",
    pdbBlock: "",
    rdkitDescriptorStatus: "calculated",
    mordredDescriptorStatus: "calculated",
    descriptorReady: true,
    sourceId: "",
    dataSource: "",
    notes: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra
  } as Molecule;
}

describe("Related Formulations", () => {
  beforeEach(() => Object.values(apiMock).forEach((fn) => fn.mockReset()));

  it("queries the database for the molecule that is open", async () => {
    apiMock.listFormulationsForMolecule.mockResolvedValue([
      {
        formulationId: "f-9",
        formulationName: "Trial blend 9",
        role: "additive",
        concentrations: [{ componentId: "c-1", value: 1.25, unit: "wt%" }],
        totalConcentration: 1.25,
        concentrationUnit: "wt%",
        componentCount: 1,
        experimentCount: 3,
        bestAverageFrictionCoefficient: 0.0714,
        bestWearScarDiameter: 355,
        highestOxidationTemperature: null,
        bestExtremePressureValue: 780
      }
    ]);

    render(
      <LanguageProvider>
        <FormulationUsageTable moleculeId="mol-1" />
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("Trial blend 9")).toBeTruthy());
    expect(apiMock.listFormulationsForMolecule).toHaveBeenCalledWith("mol-1");
    expect(screen.getByText("1.25 wt%")).toBeTruthy();
    expect(screen.getByText("0.0714")).toBeTruthy();
    expect(screen.getByText("780 N")).toBeTruthy();
    // A value that was never measured says so.
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    // No fabricated row survives.
    expect(screen.queryByText("PAO-6 + ZDDP 1.0%")).toBeNull();
  });

  it("shows an empty state when SQLite holds no relationship", async () => {
    apiMock.listFormulationsForMolecule.mockResolvedValue([]);

    render(
      <LanguageProvider>
        <FormulationUsageTable moleculeId="mol-2" />
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("This molecule is not used in any formulation yet.")).toBeTruthy());
    expect(screen.queryByText("PAO-6 + ZDDP 1.0%")).toBeNull();
  });

  it("reports a query failure rather than rendering nothing", async () => {
    apiMock.listFormulationsForMolecule.mockRejectedValue(new Error("database is locked"));

    render(
      <LanguageProvider>
        <FormulationUsageTable moleculeId="mol-3" />
      </LanguageProvider>
    );

    // An uncoded error is shown in full behind the generic summary: nothing is lost.
    expect(await screen.findByText(/database is locked/)).toBeTruthy();
  });
});

describe("MoleculeFilesPanel", () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear());
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("lists only paths that came from the database", async () => {
    apiMock.listMoleculeFiles.mockResolvedValue({
      structureFiles: [{ kind: "SVG", relativePath: "files/structures/mol-1.svg", exists: true, bytes: 2048 }],
      attachments: [
        {
          id: "att-1",
          fileName: "spectrum.csv",
          fileType: "csv",
          relativePath: "files/imports/att-1.csv",
          description: "",
          uploadedAt: "2026-02-01",
          exists: true,
          bytes: 512
        }
      ]
    });

    render(
      <LanguageProvider>
        <MoleculeFilesPanel molecule={molecule()} />
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("files/structures/mol-1.svg")).toBeTruthy());
    expect(screen.getByText("files/imports/att-1.csv")).toBeTruthy();
    // The old fixed placeholder paths are gone.
    expect(screen.queryByText("files/imports/mock-source.csv")).toBeNull();
    expect(screen.queryByText("files/reports/mock-report.pdf")).toBeNull();
    // Open is not offered at all, rather than being an enabled button that does nothing.
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("attaches a file through the backend and re-reads from the database", async () => {
    apiMock.listMoleculeFiles.mockResolvedValue({ structureFiles: [], attachments: [] });
    apiMock.importAttachment.mockResolvedValue({});

    render(
      <LanguageProvider>
        <MoleculeFilesPanel molecule={molecule()} />
      </LanguageProvider>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Attach file" })).toBeTruthy());
    apiMock.listMoleculeFiles.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    // The path now comes from a native picker rather than from a text field the user types into,
    // so a path that does not exist — or belongs to another machine — cannot be entered at all.
    chooseFile.mockResolvedValue("/Users/lab/spectrum.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Browse..." }));
    await waitFor(() =>
      expect((screen.getByTestId("attachment-source") as HTMLInputElement).value).toBe(
        "/Users/lab/spectrum.csv"
      )
    );
    // The modal's confirm button carries the same label as the toolbar button.
    const confirmButtons = screen.getAllByRole("button", { name: "Attach file" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() =>
      expect(apiMock.importAttachment).toHaveBeenCalledWith({
        linkedEntityType: "molecule",
        linkedEntityId: "mol-1",
        sourcePath: "/Users/lab/spectrum.csv",
        description: undefined
      })
    );
    await waitFor(() => expect(apiMock.listMoleculeFiles).toHaveBeenCalled());
  });

  it("asks to overwrite only for the stable file conflict code", async () => {
    apiMock.listMoleculeFiles.mockResolvedValue({
      structureFiles: [{ kind: "SVG", relativePath: "files/structures/mol-1.svg", exists: true, bytes: 2048 }],
      attachments: []
    });
    apiMock.exportWorkspaceFile
      .mockRejectedValueOnce(new Error("[file.alreadyExists] /tmp/mol-1.svg already exists."))
      .mockResolvedValueOnce({});
    chooseSaveDestination.mockResolvedValue("/tmp/mol-1.svg");

    render(
      <LanguageProvider>
        <MoleculeFilesPanel molecule={molecule()} />
      </LanguageProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));

    // The first attempt is refused because the file exists; the interface asks, in its own modal
    // rather than the platform's, and only then retries with explicit consent.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(apiMock.exportWorkspaceFile).toHaveBeenCalledTimes(2));
    expect(apiMock.exportWorkspaceFile).toHaveBeenNthCalledWith(
      1,
      "files/structures/mol-1.svg",
      "/tmp/mol-1.svg",
      false
    );
    expect(apiMock.exportWorkspaceFile).toHaveBeenNthCalledWith(
      2,
      "files/structures/mol-1.svg",
      "/tmp/mol-1.svg",
      true
    );
    expect(chooseSaveDestination).toHaveBeenCalledTimes(1);
  });
});

describe("MoleculeViewer3D", () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear());
    Object.values(mockStructureModule).forEach((fn) => fn.mockClear());
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("never builds frontend coordinates when no real structure is stored", async () => {
    render(
      <LanguageProvider>
        <MoleculeViewer3D molecule={molecule()} />
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("3D structure not generated")).toBeTruthy());
    // The decisive check: the mock generator is never reached in production rendering.
    expect(mockStructureModule.buildMock3dMolBlock).not.toHaveBeenCalled();
    expect(screen.getByText("No 3D structure")).toBeTruthy();
  });

  it("renders only after the sidecar returns readable coordinates", async () => {
    const molBlock = [
      "",
      "  RDKit          3D",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0",
      "    1.5000    0.0000    0.0000 O   0  0",
      "  1  2  1  0",
      "M  END"
    ].join("\n");
    // The backend persists the structure and returns the refreshed molecule record.
    apiMock.generateMolecule3d.mockResolvedValue({
      molecule: molecule({ molBlock, molFilePath: "files/structures/mol-1.mol" }),
      molFilePath: "files/structures/mol-1.mol",
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 2,
      mode: "real"
    });

    render(
      <LanguageProvider>
        <MoleculeViewer3D molecule={molecule()} />
      </LanguageProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: /Generate 3D/ }));

    await waitFor(() => expect(screen.getByText("Loaded 3D Structure")).toBeTruthy());
    // The backend loads the SMILES from SQLite, so only the id crosses the boundary.
    expect(apiMock.generateMolecule3d).toHaveBeenCalledWith("mol-1");
    expect(mockStructureModule.buildMock3dMolBlock).not.toHaveBeenCalled();
  });

  it("refuses a structure block that contains no coordinates", async () => {
    apiMock.generateMolecule3d.mockResolvedValue({
      molecule: molecule({ molBlock: "not a molblock" }),
      molFilePath: "",
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 0,
      mode: "real"
    });

    render(
      <LanguageProvider>
        <MoleculeViewer3D molecule={molecule()} />
      </LanguageProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: /Generate 3D/ }));

    expect(await screen.findByText(/no readable coordinates/)).toBeTruthy();
    expect(screen.getByText("No 3D structure")).toBeTruthy();
  });
});

describe("a generated structure reaches the rest of the interface", () => {
  const VALID_MOL = [
    "",
    "  RDKit          3D",
    "",
    "  2  1  0  0  0  0  0  0  0  0999 V2000",
    "    0.0000    0.0000    0.0000 C   0  0",
    "    1.5000    0.0000    0.0000 O   0  0",
    "  1  2  1  0",
    "M  END"
  ].join("\n");

  beforeEach(() => {
    apiMock.listMoleculeFiles.mockResolvedValue({ structureFiles: [], attachments: [] });
    apiMock.listFormulationsForMolecule.mockResolvedValue([]);
  });

  it("hands the refreshed record to the drawer's caller", async () => {
    const saved = molecule({ molBlock: VALID_MOL, molFilePath: "files/structures/mol-1-v2.mol" });
    apiMock.generateMolecule3d.mockResolvedValue({
      molecule: saved,
      molFilePath: "files/structures/mol-1-v2.mol",
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 2,
      replacedVersions: 0,
      cleanupFailures: [],
      mode: "real"
    });
    const onGenerated = vi.fn();

    renderWithLanguage(
      <MoleculeDetailDrawer molecule={molecule()} open onClose={() => {}} onGenerated={onGenerated} />
    );
    // The 3D tab is not the default one, so it has to be opened first.
    fireEvent.click(await screen.findByText("3D Structure"));
    fireEvent.click(await screen.findByRole("button", { name: /Generate 3D/ }));

    // Without this the drawer, the Files panel, and the library behind them would all keep
    // describing a molecule that has no structure.
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(saved));
    expect(onGenerated.mock.calls[0][0].molFilePath).toBe("files/structures/mol-1-v2.mol");
  });

  it("reports a superseded file the backend could not remove instead of an unqualified success", async () => {
    apiMock.generateMolecule3d.mockResolvedValue({
      molecule: molecule({ molBlock: VALID_MOL }),
      molFilePath: "files/structures/mol-1-v2.mol",
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 2,
      replacedVersions: 1,
      cleanupFailures: ["files/structures/mol-1-v1.mol: Permission denied"],
      mode: "real"
    });

    renderWithLanguage(<MoleculeViewer3D molecule={molecule()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate 3D/ }));

    expect(await screen.findByText(/mol-1-v1\.mol/)).toBeTruthy();
  });

  it("updates the library row when the drawer reports a generated structure", async () => {
    const original = molecule({ molFilePath: "" });
    const saved = molecule({ molFilePath: "files/structures/mol-1-v2.mol", molBlock: VALID_MOL });
    apiMock.listMoleculePage.mockResolvedValue({
      items: [original],
      total: 1,
      page: 1,
      pageSize: 10
    });
    apiMock.getMolecule.mockResolvedValue(original);
    apiMock.generateMolecule3d.mockResolvedValue({
      molecule: saved,
      molFilePath: saved.molFilePath,
      sdfFilePath: "",
      pdbFilePath: "",
      atomCount: 2,
      replacedVersions: 0,
      cleanupFailures: [],
      mode: "real"
    });

    renderWithLanguage(<MoleculeLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByText("3D Structure"));
    fireEvent.click(await screen.findByRole("button", { name: /Generate 3D/ }));

    // The drawer keeps showing the molecule, now with its structure loaded rather than absent.
    await waitFor(() => expect(screen.getByText("Loaded 3D Structure")).toBeTruthy());
    expect(apiMock.generateMolecule3d).toHaveBeenCalledWith("mol-1");
  });
});
