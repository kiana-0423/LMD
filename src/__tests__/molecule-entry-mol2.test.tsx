// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";
import { LanguageProvider, SUPPORTED_LANGUAGES } from "../i18n/LanguageContext";

const api = vi.hoisted(() => ({ mol2ToSmiles: vi.fn(), saveMoleculeWithRequiredDescriptors: vi.fn() }));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock(api);
});
import MoleculeEntryPage from "../features/molecule-entry/MoleculeEntryPage";
import MainLayout from "../layouts/MainLayout";

beforeEach(() => {
  api.mol2ToSmiles.mockReset();
  api.saveMoleculeWithRequiredDescriptors.mockReset();
  api.mol2ToSmiles.mockResolvedValue({ smiles: "CCO", inferredBondIds: [], normalizedAtomTypes: [] });
});
afterEach(cleanup);

function mol2File(name = "ethanol.mol2", contents = "@<TRIPOS>MOLECULE\nethanol") {
  const file = new File([contents], name);
  // jsdom's File does not expose Blob.text in all supported versions.
  Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(contents) });
  return file;
}
function choose(file: File) {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

describe("MOL2 molecule entry", () => {
  it("keeps the form and saved result in the same fixed workspace panel", async () => {
    window.localStorage.setItem("lmd.language.v2", "en-US");
    const messages = messagesForLanguage("en-US");
    api.saveMoleculeWithRequiredDescriptors.mockResolvedValue({
      name: "Ethanol", smilesCanonical: "CCO", formula: "C2H6O", molecularWeight: 46.07,
      inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N", structureSvg: '<svg xmlns="http://www.w3.org/2000/svg" />'
    });
    const { container } = render(<LanguageProvider><MemoryRouter initialEntries={["/molecule-entry"]}>
      <Routes><Route element={<MainLayout />}><Route path="/molecule-entry" element={<MoleculeEntryPage />} /></Route></Routes>
    </MemoryRouter></LanguageProvider>);
    const panel = container.querySelector(".workspace-fixed-panel")!;
    const output = panel.querySelector(".molecule-entry-output")!;
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Ethanol" } });
    fireEvent.change(screen.getByLabelText("SMILES"), { target: { value: "CCO" } });
    expect(container.querySelector(".paged-content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages["ui.saveMoleculeAndCalculateDescriptors"] }));
    await waitFor(() => expect(within(output as HTMLElement).getByDisplayValue("LFQSCWFLJHTTHZ-UHFFFAOYSA-N")).toBeTruthy(), { timeout: 3000 });
    expect(panel.querySelector(".molecule-entry-output")).toBe(output);
    expect(screen.getByLabelText("Name")).toBe(name);
    expect(name).toHaveValue("Ethanol");
    expect(within(output as HTMLElement).getByAltText(messages["ui.generated2dStructure"])).toBeTruthy();
    expect(container.querySelector(".paged-content")).toBeNull();
    expect(screen.getByRole("button", { name: messages["ui.viewInMoleculeLibrary"] })).toBeEnabled();
  });

  for (const language of SUPPORTED_LANGUAGES) {
    it(`fills SMILES and a missing name in ${language} without saving`, async () => {
      const messages = messagesForLanguage(language);
      renderWithLanguage(<MoleculeEntryPage />, language);
      expect(await screen.findByRole("button", { name: messages["moleculeEntry.importMol2"] })).toBeTruthy();
      const file = mol2File("ethanol.MOL2");
      choose(file);
      await waitFor(() => expect(screen.getByLabelText("SMILES")).toHaveValue("CCO"));
      expect(screen.getByLabelText(messages["ui.name"])).toHaveValue("ethanol");
      expect(api.mol2ToSmiles).toHaveBeenCalledWith(await file.text());
      expect(api.saveMoleculeWithRequiredDescriptors).not.toHaveBeenCalled();
    });
  }

  it("preserves user metadata and saves the converted SMILES through the existing save path", async () => {
    renderWithLanguage(<MoleculeEntryPage />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My sample" } });
    fireEvent.change(screen.getByLabelText("Data Source"), { target: { value: "Lab source" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep this" } });
    choose(mol2File());
    await waitFor(() => expect(screen.getByLabelText("SMILES")).toHaveValue("CCO"));
    expect(screen.getByLabelText("Name")).toHaveValue("My sample");
    expect(screen.getByLabelText("Data Source")).toHaveValue("Lab source");
    fireEvent.click(screen.getByRole("button", { name: messagesForLanguage("en-US")["ui.saveMoleculeAndCalculateDescriptors"] }));
    await waitFor(() => expect(api.saveMoleculeWithRequiredDescriptors).toHaveBeenCalledWith(expect.objectContaining({
      smiles: "CCO", name: "My sample", dataSource: "Lab source", notes: "Keep this", category: "candidate"
    })), { timeout: 3000 });
  });

  it("preserves the form on conversion failure and can retry the same file", async () => {
    api.mol2ToSmiles.mockRejectedValueOnce(new Error("[structure.processingFailed] Invalid MOL2"));
    renderWithLanguage(<MoleculeEntryPage />);
    fireEvent.change(screen.getByLabelText("SMILES"), { target: { value: "CC" } });
    const file = mol2File();
    choose(file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid MOL2");
    expect(screen.getByLabelText("SMILES")).toHaveValue("CC");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    choose(file);
    await waitFor(() => expect(screen.getByLabelText("SMILES")).toHaveValue("CCO"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks edits and saving while conversion is pending", async () => {
    let finish!: (value: { smiles: string; inferredBondIds: string[]; normalizedAtomTypes: string[] }) => void;
    api.mol2ToSmiles.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithLanguage(<MoleculeEntryPage />);
    choose(mol2File());
    await waitFor(() => expect(api.mol2ToSmiles).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("SMILES")).toBeDisabled();
    expect(screen.getByRole("button", { name: messagesForLanguage("en-US")["ui.saveMoleculeAndCalculateDescriptors"] })).toBeDisabled();
    finish({ smiles: "CCO", inferredBondIds: [], normalizedAtomTypes: [] });
    await waitFor(() => expect(screen.getByLabelText("SMILES")).not.toBeDisabled());
  });

  it("shows inferred bonds and preserves their provenance alongside existing notes", async () => {
    api.mol2ToSmiles.mockResolvedValue({ smiles: "c1ccccc1", inferredBondIds: ["1", "2", "3", "4", "5", "6"], normalizedAtomTypes: [] });
    renderWithLanguage(<MoleculeEntryPage />);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Lab record" } });
    choose(mol2File("ring.mol2"));
    expect(await screen.findByRole("alert")).toHaveTextContent("inferred 6 aromatic bond orders");
    const notes = (screen.getByLabelText("Notes") as HTMLTextAreaElement).value;
    expect(notes).toContain("Lab record");
    expect(notes).toContain("bond IDs: 1, 2, 3, 4, 5, 6");
    choose(mol2File("ring.mol2"));
    await waitFor(() => expect(api.mol2ToSmiles).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Notes")).toHaveValue(notes);
    api.mol2ToSmiles.mockResolvedValue({ smiles: "CCO", inferredBondIds: [], normalizedAtomTypes: [] });
    await waitFor(() => expect(screen.getByLabelText("SMILES")).not.toBeDisabled());
    choose(mol2File());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("discloses oxygen type corrections even when no aromatic bonds were inferred", async () => {
    api.mol2ToSmiles.mockResolvedValue({ smiles: "CC(=O)OC", inferredBondIds: [], normalizedAtomTypes: ["19:O.co2->O.3"] });
    renderWithLanguage(<MoleculeEntryPage />);
    choose(mol2File("ester.mol2"));
    expect(await screen.findByRole("alert")).toHaveTextContent("normalized 1 oxygen atom types");
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toContain("19:O.co2->O.3");
  });

  it.each(["wrong-extension", "empty", "oversized"])("rejects %s files before calling the sidecar", async (kind) => {
    renderWithLanguage(<MoleculeEntryPage />);
    const file = kind === "wrong-extension" ? mol2File("wrong.sdf") : kind === "empty" ? mol2File("empty.mol2", "") : mol2File();
    if (kind === "oversized") Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
    choose(file);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.mol2ToSmiles).not.toHaveBeenCalled();
  });
});
