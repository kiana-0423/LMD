// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";
import type { SketcherValidationResult } from "../types";

const api = vi.hoisted(() => ({
  importSketcherStructure: vi.fn(), validateSketcherSmiles: vi.fn(), molfileToSmiles: vi.fn(),
  calculateSketcherDescriptors: vi.fn(), importNewMolecule: vi.fn(), checkMoleculeDuplicate: vi.fn(), smilesToMolfile: vi.fn()
}));
const canvas = vi.hoisted(() => ({ smiles: "", molfile: "", setMolecule: vi.fn() }));
vi.mock("../lib/moleculeSketcherApi", () => api);
vi.mock("../lib/api", async () => (await import("./apiMock")).createApiMock());
vi.mock("../features/molecule-sketcher/KetcherEditor", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  return { default: forwardRef(function Drawing(props: {
    toolbar?: React.ReactNode; onReady?: (ready: boolean) => void; onEdit?: () => void;
    onChange?: (state: { smiles: string; molfile: string }) => void;
  }, ref) {
    function edit(smiles: string, molfile: string) {
      canvas.smiles = smiles;
      canvas.molfile = molfile;
      props.onEdit?.();
      props.onChange?.({ smiles, molfile });
    }
    const { onReady } = props;
    useEffect(() => { onReady?.(true); }, [onReady]);
    useImperativeHandle(ref, () => ({
      getSmiles: async () => canvas.smiles,
      getMolfile: async () => canvas.molfile,
      setMolecule: async (content: string) => {
        await canvas.setMolecule(content);
        edit("CCO", content);
      },
      clear: async () => edit("", "")
    }));
    return <div data-testid="drawing-canvas">{props.toolbar}
      <button onClick={() => edit("CCN", "edited MOL")}>Edit nitrogen</button>
      <button onClick={() => edit("CCO", "undo MOL")}>Undo edit</button>
      <button onClick={() => edit("", "")}>Clear drawing</button>
    </div>;
  }) };
});
import MoleculeSketcherPage from "../features/molecule-sketcher/MoleculeSketcherPage";

function validation(smiles: string): SketcherValidationResult {
  return { valid: true, canonicalSmiles: smiles, smilesCanonical: smiles,
    formula: smiles === "CCO" ? "C2H6O" : "C2H7N", molecularWeight: 46, inchiKey: smiles };
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  canvas.setMolecule.mockReset();
  canvas.smiles = "";
  canvas.molfile = "";
  api.importSketcherStructure.mockResolvedValue({ molfile: "\nimported MOL", validation: validation("CCO"), inferredBondIds: [] });
  api.validateSketcherSmiles.mockImplementation(async (smiles) => validation(smiles));
  api.calculateSketcherDescriptors.mockResolvedValue({ valid: true, descriptorCount: 1, descriptors: {}, preview: {} });
  api.checkMoleculeDuplicate.mockResolvedValue({ duplicate: false });
  api.importNewMolecule.mockResolvedValue({ success: true, moleculeId: "saved" });
});
afterEach(cleanup);

function choose(name = "example.mol2") {
  const file = new File(["structure records"], name);
  Object.defineProperty(file, "text", { value: async () => "structure records" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
async function loaded() {
  await waitFor(() => expect(screen.getByTestId("canvas-formula")).toHaveTextContent("C2H6O"));
}

it.each(["pdb", "mol2"])("imports %s into the same editable canvas with a formula", async (format) => {
  renderWithLanguage(<MoleculeSketcherPage />);
  const drawing = screen.getByTestId("drawing-canvas");
  choose(`sample.${format}`);
  await loaded();
  expect(canvas.setMolecule).toHaveBeenCalledWith("\nimported MOL");
  expect(screen.getByTestId("drawing-canvas")).toBe(drawing);
  expect(api.importSketcherStructure).toHaveBeenCalledWith("structure records", format);
  expect(api.importNewMolecule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Edit nitrogen"));
  expect(screen.getByTestId("canvas-formula")).toHaveTextContent("—");
  await waitFor(() => expect(screen.getByTestId("canvas-formula")).toHaveTextContent("C2H7N"));
  fireEvent.click(screen.getByText("Undo edit"));
  await loaded();
});

it("keeps the previous drawing and formula when importing fails", async () => {
  renderWithLanguage(<MoleculeSketcherPage />);
  choose();
  await loaded();
  api.importSketcherStructure.mockRejectedValue(new Error("bad PDB"));
  choose("broken.pdb");
  expect(await screen.findByDisplayValue("bad PDB")).toBeTruthy();
  expect(canvas.setMolecule).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("canvas-formula")).toHaveTextContent("C2H6O");
  fireEvent.click(screen.getByText("Edit nitrogen"));
  expect(screen.queryByDisplayValue("bad PDB")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("canvas-formula")).toHaveTextContent("C2H7N"));
});

it("discards a delayed formula result after clearing the canvas", async () => {
  renderWithLanguage(<MoleculeSketcherPage />);
  choose();
  await loaded();
  let finish!: (result: SketcherValidationResult) => void;
  api.validateSketcherSmiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText("Edit nitrogen"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByText("Clear drawing"));
  await act(async () => finish(validation("CCN")));
  expect(screen.getByTestId("canvas-formula")).toHaveTextContent("—");
  expect((screen.getByRole("textbox", { name: messagesForLanguage("en-US")["ui.smilesInput"] }) as HTMLTextAreaElement).value).toBe("");
});

it("saves edited SMILES and MOL with import provenance after recalculating descriptors", async () => {
  const messages = messagesForLanguage("en-US");
  renderWithLanguage(<MoleculeSketcherPage />);
  choose("original.pdb");
  await loaded();
  fireEvent.click(screen.getByText("Edit nitrogen"));
  await waitFor(() => expect(screen.getByTestId("canvas-formula")).toHaveTextContent("C2H7N"));
  fireEvent.click(screen.getByRole("button", { name: messages["ui.calculateDescriptors"] }));
  await waitFor(() => expect(api.calculateSketcherDescriptors).toHaveBeenCalledWith("CCN"));
  await waitFor(() => expect(screen.getByRole("button", { name: messages["ui.saveToMoleculeLibrary"] })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: messages["ui.saveToMoleculeLibrary"] }));
  await waitFor(() => expect(api.importNewMolecule).toHaveBeenCalledWith(expect.objectContaining({
    canonicalSmiles: "CCN", molfile: "edited MOL", formula: "C2H7N", notes: expect.stringContaining("original.pdb")
  })));
});

it("shows and persists atom type corrections without inferred aromatic bonds", async () => {
  api.importSketcherStructure.mockResolvedValue({ molfile: "\nimported MOL", validation: validation("CCO"),
    inferredBondIds: [], normalizedAtomTypes: ["3:O.co2->O.3"] });
  const messages = messagesForLanguage("en-US");
  renderWithLanguage(<MoleculeSketcherPage />);
  choose("oxygen.mol2");
  await loaded();
  expect(screen.getByText(messages["sketcher.reviewBonds"])).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: messages["ui.calculateDescriptors"] }));
  await waitFor(() => expect(screen.getByRole("button", { name: messages["ui.saveToMoleculeLibrary"] })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: messages["ui.saveToMoleculeLibrary"] }));
  await waitFor(() => expect(api.importNewMolecule).toHaveBeenCalledWith(expect.objectContaining({
    notes: expect.stringContaining('"normalizedAtomTypes":["3:O.co2->O.3"]')
  })));
});
