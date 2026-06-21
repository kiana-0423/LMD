// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";

const apiMock = vi.hoisted(() => ({
  deleteMolecule: vi.fn(),
  listMolecules: vi.fn()
}));

vi.mock("../lib/api", () => apiMock);

function renderPage() {
  return render(
    <MemoryRouter>
      <MoleculeLibraryPage />
    </MemoryRouter>
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
    apiMock.deleteMolecule.mockReset();
    apiMock.listMolecules.mockReset();
  });

  it("shows loading while molecule records are pending", () => {
    apiMock.listMolecules.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPage();
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("shows an error card when molecule loading fails", async () => {
    apiMock.listMolecules.mockRejectedValueOnce(new Error("load failed"));
    renderPage();
    expect(await screen.findByText("分子库加载失败")).toBeTruthy();
    expect(screen.getByText("load failed")).toBeTruthy();
  });

  it("shows an empty state for an empty molecule library", async () => {
    apiMock.listMolecules.mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByText("数据库中暂无分子记录。")).toBeTruthy();
  });

  it("renders molecule records after loading", async () => {
    apiMock.listMolecules.mockResolvedValueOnce([molecule]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Ethanol")).toBeTruthy());
    expect(screen.getByText("C2H6O")).toBeTruthy();
    expect(screen.getByText("已计算")).toBeTruthy();
  });
});
