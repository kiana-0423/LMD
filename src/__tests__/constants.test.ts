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
    expect(descriptorStatusLabels.calculated).toBe("已计算");
    expect(descriptorStatusLabels.mock).toBe("模拟");
    expect(descriptorStatusLabels.failed).toBe("失败");
  });

  it("contains additive function labels used by forms", () => {
    expect(additiveFunctionLabels.antiwear).toBe("抗磨剂");
    expect(additiveFunctionLabels.antioxidant).toBe("抗氧剂");
  });
});
