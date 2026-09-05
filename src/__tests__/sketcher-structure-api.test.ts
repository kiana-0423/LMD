import { expect, it, vi } from "vitest";
vi.mock("../lib/tauri", () => ({ invokeCommand: vi.fn() }));
import { invokeCommand } from "../lib/tauri";
import { importSketcherStructure } from "../lib/moleculeSketcherApi";

it.each(["pdb", "mol2"] as const)("requests 2D MOL for %s and retains formula and inference", async (format) => {
  vi.mocked(invokeCommand).mockResolvedValue({ data: {
    content: "\nMol header", canonical_smiles: "CCO", formula: "C2H6O", molecular_weight: 46.07,
    inchi_key: "ETHANOL", inferred_bond_ids: ["1"], normalized_atom_types: ["3:O.co2->O.3"]
  } });
  const result = await importSketcherStructure("original structure", format);
  expect(invokeCommand).toHaveBeenLastCalledWith("convert_molecule_format", {
    inputText: "original structure", inputFormat: format, outputFormat: "mol", generate2d: true
  });
  expect(result.molfile).toBe("\nMol header");
  expect(result.validation).toMatchObject({ canonicalSmiles: "CCO", formula: "C2H6O", molecularWeight: 46.07, inchiKey: "ETHANOL" });
  expect(result.inferredBondIds).toEqual(["1"]);
  expect(result.normalizedAtomTypes).toEqual(["3:O.co2->O.3"]);
});

it("refuses incomplete import results", async () => {
  vi.mocked(invokeCommand).mockResolvedValue({ data: { content: "" } });
  await expect(importSketcherStructure("invalid", "pdb")).rejects.toThrow("[structure.processingFailed]");
});
