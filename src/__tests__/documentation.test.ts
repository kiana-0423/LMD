import { describe, expect, it } from "vitest";
// Vite inlines these at transform time, so the test needs no Node filesystem types.
import README from "../../README.md?raw";
import SMOKE_TESTS from "../../docs/installer-smoke-tests.md?raw";

/**
 * The README is the only place a reader learns what is real. These checks fail when it drifts
 * back to describing behaviour that has since been implemented, or claims something that is not.
 */
describe("README accuracy", () => {
  const CONTRADICTED = [
    "prediction placeholders",
    "still return mock payloads",
    "prediction services are still mocks",
    "Model training and prediction services are still mocks",
    "create and edit workflows remain MVP placeholders",
    "`allow_mock` defaults to false"
  ];

  it.each(CONTRADICTED)("no longer claims %j", (claim) => {
    expect(README).not.toContain(claim);
  });

  it("keeps the limitations that are still genuinely true", () => {
    const limitations = README.slice(README.indexOf("## Current Limitations"));
    expect(limitations).toContain("Clean-machine installer validation is outstanding");
    expect(limitations).toContain("unsigned");
    expect(limitations).toContain("wasm-unsafe-eval");
    // Ranking must not be described as structure generation.
    expect(limitations).toContain("LMD does not generate new structures");
  });

  it("does not describe Molecule Design as a feature", () => {
    const features = README.slice(README.indexOf("## Main Features"), README.indexOf("## Architecture Notes"));
    expect(features).not.toContain("Molecule design");
    expect(features).toContain("Molecule Screening");
  });

  it("documents the clean-machine procedure it refers to", () => {
    expect(README).toContain("docs/installer-smoke-tests.md");
    for (const requirement of ["sidecar", "Ketcher", "model", "export", "uninstall", "WebView2"]) {
      expect(SMOKE_TESTS.toLowerCase()).toContain(requirement.toLowerCase());
    }
  });
});
