// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser demo, exercised the only way it can now be reached: with the build flag set.
 *
 * Without `VITE_DEMO_MODE=true` these same calls are refused — see `tauri.test.ts`. Splitting the
 * two apart is the point: a desktop build cannot reach this data at all.
 */
describe("explicit demo mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_DEMO_MODE", "true");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns molecule records", async () => {
    const { listMolecules } = await import("../lib/api");
    const molecules = await listMolecules();
    expect(molecules.length).toBeGreaterThan(0);
    expect(molecules[0]).toHaveProperty("id");
    expect(molecules[0]).toHaveProperty("smilesCanonical");
  });

  it("returns base oil and additive records", async () => {
    const { listAdditives, listBaseOils } = await import("../lib/api");
    const [baseOils, additives] = await Promise.all([listBaseOils(), listAdditives()]);
    expect(baseOils.length).toBeGreaterThan(0);
    expect(additives.length).toBeGreaterThan(0);
    expect(baseOils[0]).toHaveProperty("baseOilType");
    expect(additives[0]).toHaveProperty("functionTypes");
  });

  it("keeps dashboard counts aligned with the demo records", async () => {
    const { getDashboardSummary, listAdditives, listBaseOils, listMolecules } = await import("../lib/api");
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
