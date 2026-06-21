// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getDashboardSummary, listAdditives, listBaseOils, listMolecules } from "../lib/api";

describe("api mock fallback", () => {
  it("returns molecule records outside Tauri", async () => {
    const molecules = await listMolecules();
    expect(molecules.length).toBeGreaterThan(0);
    expect(molecules[0]).toHaveProperty("id");
    expect(molecules[0]).toHaveProperty("smilesCanonical");
  });

  it("returns base oil and additive mock data outside Tauri", async () => {
    const [baseOils, additives] = await Promise.all([listBaseOils(), listAdditives()]);
    expect(baseOils.length).toBeGreaterThan(0);
    expect(additives.length).toBeGreaterThan(0);
    expect(baseOils[0]).toHaveProperty("baseOilType");
    expect(additives[0]).toHaveProperty("functionTypes");
  });

  it("keeps dashboard counts aligned with mock data", async () => {
    const [summary, molecules, baseOils, additives] = await Promise.all([
      getDashboardSummary(),
      listMolecules(),
      listBaseOils(),
      listAdditives()
    ]);
    expect(summary.moleculeCount).toBe(molecules.length);
    expect(summary.baseOilCount).toBe(baseOils.length);
    expect(summary.additiveCount).toBe(additives.length);
  });
});
