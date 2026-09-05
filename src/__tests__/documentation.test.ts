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
    // Ranking must not be described as structure generation, and generation must be described
    // with its optional-template paths, and without a novelty or synthesis claim.
    expect(limitations).toContain("LMD does not generate new structures");
    expect(limitations).toContain("Molecular Design accepts an optional chemical-class template");
    expect(limitations).toContain("With no template, at least one selected library or user seed is required");
    expect(limitations).toContain("not a claim of novelty");
    expect(limitations).toContain("Synthesis feasibility is");
    expect(limitations).toContain("never become training");
  });

  it("describes Molecular Design as the separate workflow it is", () => {
    const features = README.slice(README.indexOf("## Main Features"), README.indexOf("## Architecture Notes"));
    expect(features).toContain("Molecular Design");
    expect(features).toContain("Molecule Screening");
    // The assessment vocabulary the interface uses is the one the README explains.
    expect(README).toContain("supported by validation");
    expect(README).toContain("exploratory");
    expect(README).toContain("unavailable");
    expect(README).not.toContain("confidence percentage is");
  });

  it("documents the clean-machine procedure it refers to", () => {
    expect(README).toContain("docs/installer-smoke-tests.md");
    for (const requirement of ["sidecar", "Ketcher", "model", "export", "uninstall", "WebView2"]) {
      expect(SMOKE_TESTS.toLowerCase()).toContain(requirement.toLowerCase());
    }
  });
});
