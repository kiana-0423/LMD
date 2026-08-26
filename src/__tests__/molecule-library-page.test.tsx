// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";
import KetcherTranslationBridge from "../features/molecule-sketcher/KetcherTranslationBridge";
import { LanguageProvider } from "../i18n/LanguageContext";

// Built from the real API contract, so a component that calls a function this test never thought
// about gets a working stub instead of an unhandled rejection.
const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <MoleculeLibraryPage />
      </MemoryRouter>
    </LanguageProvider>
  );
}

const molecule = {
  id: "mol-1",
  name: "Ethanol",
  aliases: "EtOH",
  smilesRaw: "CCO",
  smilesCanonical: "CCO",
  inchi: "",
  inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
  formula: "C2H6O",
  molecularWeight: 46.069,
  category: "solvent",
  additiveFunctionTags: [],
  structureSvgPath: "",
  structureSvg: "",
  molFilePath: "",
  sdfFilePath: "",
  pdbFilePath: "",
  rdkitDescriptorStatus: "calculated",
  mordredDescriptorStatus: "calculated",
  descriptorReady: true,
  sourceId: "",
  dataSource: "test",
  notes: "",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
};

describe("MoleculeLibraryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMock.deleteMolecule.mockReset();
    apiMock.getMolecule.mockReset();
    apiMock.listMoleculePage.mockReset();
    apiMock.getMolecule.mockResolvedValue(molecule);
  });

  it("shows loading while molecule records are pending", () => {
    apiMock.listMoleculePage.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPage();
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("shows an error card when molecule loading fails", async () => {
    apiMock.listMoleculePage.mockRejectedValueOnce(new Error("load failed"));
    renderPage();
    expect(await screen.findByText("Failed to load the molecule library")).toBeTruthy();
    expect(screen.getByText(/load failed/)).toBeTruthy();
  });

  it("shows an empty state for an empty molecule library", async () => {
    apiMock.listMoleculePage.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    renderPage();
    expect(await screen.findByText("No molecule records in the database.")).toBeTruthy();
  });

  it("renders molecule records after loading", async () => {
    apiMock.listMoleculePage.mockResolvedValueOnce({
      items: [molecule],
      total: 1,
      page: 1,
      pageSize: 10
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Ethanol")).toBeTruthy());
    expect(screen.getByText("C2H6O")).toBeTruthy();
    expect(screen.getByText("Calculated")).toBeTruthy();
  });

  it("renders the molecule library in the saved Japanese language", async () => {
    window.localStorage.setItem("lmd.language.v2", "ja-JP");
    apiMock.listMoleculePage.mockResolvedValueOnce({
      items: [molecule],
      total: 1,
      page: 1,
      pageSize: 10
    });
    render(
      <LanguageProvider>
        <KetcherTranslationBridge />
        <MemoryRouter>
          <MoleculeLibraryPage />
        </MemoryRouter>
      </LanguageProvider>
    );
    expect(await screen.findByRole("heading", { name: "分子ライブラリ" })).toBeTruthy();
    expect(await screen.findByPlaceholderText("名前、SMILES、InChIKey を検索")).toBeTruthy();
    expect(await screen.findByText("Ethanol")).toBeTruthy();
    expect(await screen.findByText("計算済み")).toBeTruthy();
  });
});
