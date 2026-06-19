import { describe, expect, it } from "vitest";
import type { DashboardSummary, Molecule, MoleculeDescriptor } from "../types";

describe("core type shapes", () => {
  it("accepts a molecule-shaped object", () => {
    const molecule: Molecule = {
      id: "mol-1",
      name: "Ethanol",
      aliases: "",
      smilesRaw: "CCO",
      smilesCanonical: "CCO",
      inchi: "",
      inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
      formula: "C2H6O",
      molecularWeight: 46.069,
      category: "candidate",
      additiveFunctionTags: [],
      structureSvgPath: "",
      structureSvg: "",
      molFilePath: "",
      sdfFilePath: "",
      pdbFilePath: "",
      rdkitDescriptorStatus: "calculated",
      mordredDescriptorStatus: "calculated",
      descriptorReady: true,
      sourceId: "manual",
      dataSource: "manual",
      notes: "",
      createdAt: "2026-06-19T00:00:00Z",
      updatedAt: "2026-06-19T00:00:00Z"
    };
    expect(molecule.descriptorReady).toBe(true);
  });

  it("accepts a descriptor-shaped object", () => {
    const descriptor: MoleculeDescriptor = {
      id: "desc-1",
      moleculeId: "mol-1",
      descriptorSet: "rdkit",
      descriptorVersion: "2026.06",
      descriptorsJson: { MolWt: 46.069 },
      descriptorCount: 1,
      status: "calculated",
      mode: "real",
      errorMessage: "",
      calculatedAt: "2026-06-19T00:00:00Z"
    };
    expect(descriptor.descriptorsJson).toHaveProperty("MolWt");
  });

  it("accepts an extended dashboard summary", () => {
    const summary: DashboardSummary = {
      moleculeCount: 1,
      baseOilCount: 0,
      additiveCount: 0,
      formulationCount: 0,
      formulationComponentCount: 0,
      experimentCount: 0,
      performanceResultCount: 0,
      descriptorRecordCount: 2,
      descriptorReadyCount: 1,
      descriptorFailedCount: 0,
      descriptorRealCount: 2
    };
    expect(summary.descriptorRecordCount).toBe(2);
  });
});
