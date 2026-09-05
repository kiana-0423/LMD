import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../lib/tauri", () => ({ invokeCommand: vi.fn() }));
import { invokeCommand } from "../lib/tauri";
import { mol2ToSmiles } from "../lib/api/molecule";

beforeEach(() => vi.resetAllMocks());

it("uses the registered format-conversion command and unwraps the real response", async () => {
  vi.mocked(invokeCommand).mockResolvedValue({ ok: true, data: { content: "CCO\n" } });
  await expect(mol2ToSmiles("atom and bond records")).resolves.toEqual({ smiles: "CCO", inferredBondIds: [], normalizedAtomTypes: [] });
  expect(invokeCommand).toHaveBeenCalledWith("convert_molecule_format", {
    inputText: "atom and bond records", inputFormat: "mol2", outputFormat: "smiles"
  });
});

it("retains inferred bond IDs so the interface can disclose and record the interpretation", async () => {
  vi.mocked(invokeCommand).mockResolvedValue({ ok: true, data: { content: "c1ccccc1", inferred_bond_ids: ["1", "2"] } });
  await expect(mol2ToSmiles("ring records")).resolves.toEqual({ smiles: "c1ccccc1", inferredBondIds: ["1", "2"], normalizedAtomTypes: [] });
});

it("rejects an empty conversion instead of clearing the input field", async () => {
  vi.mocked(invokeCommand).mockResolvedValue({ ok: true, data: { content: " " } });
  await expect(mol2ToSmiles("bad block")).rejects.toThrow("[structure.processingFailed]");
});

it("retains original atom IDs and type changes for import provenance", async () => {
  vi.mocked(invokeCommand).mockResolvedValue({ data: {
    content: "CC(=O)OC", normalized_atom_types: ["19:O.co2->O.3", "20:O.co2->O.2"]
  } });
  expect((await mol2ToSmiles("ester records")).normalizedAtomTypes).toEqual(["19:O.co2->O.3", "20:O.co2->O.2"]);
});
