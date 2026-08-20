import { describe, expect, it } from "vitest";
import {
  additiveFunctionLabels,
  descriptorStatusLabels,
  formalRoutes,
  moleculeCategories,
  moleculeCategoryLabels
} from "../lib/constants";

describe("constants", () => {
  it("defines a label for every molecule category", () => {
    for (const category of moleculeCategories) {
      expect(moleculeCategoryLabels[category]).toBeTruthy();
    }
  });

  it("contains the primary formal routes", () => {
    expect(formalRoutes.map((route) => route.key)).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/molecules",
        "/descriptors",
        "/data-mining/molecule-performance",
        "/data-mining/formulation-prediction",
        "/data-mining/molecule-design"
      ])
    );
  });

  it("maps common descriptor statuses to display labels", () => {
    expect(descriptorStatusLabels.calculated).toBe("Calculated");
    expect(descriptorStatusLabels.mock).toBe("Mock");
    expect(descriptorStatusLabels.failed).toBe("Failed");
  });

  it("contains additive function labels used by forms", () => {
    expect(additiveFunctionLabels.antiwear).toBe("Antiwear agent");
    expect(additiveFunctionLabels.antioxidant).toBe("Antioxidant");
  });
});
