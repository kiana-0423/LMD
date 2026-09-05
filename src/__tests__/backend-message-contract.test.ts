import { describe, expect, it } from "vitest";
// Vite inlines these at transform time, so the test reads the real backend sources without
// needing Node filesystem types — and fails when they drift.
import MESSAGES_RS from "../../src-tauri/src/commands/messages.rs?raw";
import FEATURES_RS from "../../src-tauri/src/commands/features.rs?raw";
import ERRORS_RS from "../../src-tauri/src/commands/errors.rs?raw";
import SIDECAR_MESSAGES from "../../python-sidecar/lmd_sidecar/utils/messages.py?raw";
import SIDECAR_ERRORS from "../../python-sidecar/lmd_sidecar/utils/errors.py?raw";
import { SUPPORTED_LANGUAGES } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";
import { translateMessage, isKnownMessage } from "../lib/backendMessages";
import { describeBackendError, isTranslatedCode } from "../lib/backendErrors";

/**
 * A message code is a contract between three programs.
 *
 * Rust and Python name a situation; the frontend holds the wording. Nothing type-checks across
 * that boundary, so a renamed constant on either side produces a message that renders as its
 * English detail — quietly, in an interface that is otherwise fully translated. The audit cannot
 * see this: there is no hard-coded string anywhere, only a key nobody looks up.
 *
 * These tests read the backend sources and check both directions.
 */

/** Every `pub const NAME: &str = "code";` in a Rust module. */
function rustCodes(source: string): string[] {
  return [...source.matchAll(/pub const [A-Z_]+: &str = "([a-z][A-Za-z0-9]*\.[A-Za-z0-9]+)";/g)].map(
    (match) => match[1]
  );
}

/** The codes `UnitProblem::message_code` returns, which are written inline rather than as consts. */
function unitProblemCodes(source: string): string[] {
  const body = source.slice(source.indexOf("pub fn message_code"), source.indexOf("pub fn to_message"));
  return [...body.matchAll(/"(concentration\.[A-Za-z]+)"/g)].map((match) => match[1]);
}

/** Every `NAME = "code"` in the sidecar's message module. */
function pythonCodes(source: string): string[] {
  return [...source.matchAll(/^[A-Z_]+ = "([a-z][A-Za-z0-9]*\.[A-Za-z0-9]+)"$/gm)].map((match) => match[1]);
}

const BACKEND_CODES = [...rustCodes(MESSAGES_RS), ...unitProblemCodes(FEATURES_RS), ...pythonCodes(SIDECAR_MESSAGES)];

const BACKEND_ERROR_CODES = [...rustCodes(ERRORS_RS), ...pythonCodes(SIDECAR_ERRORS)];

describe("backend message codes", () => {
  it("finds the codes the backends actually define", () => {
    // A guard on the extraction itself: a regex that silently matched nothing would make every
    // test below pass while checking nothing at all.
    expect(BACKEND_CODES.length).toBeGreaterThan(25);
    expect(BACKEND_CODES).toContain("dataset.excludedOtherBasis");
    expect(BACKEND_CODES).toContain("concentration.basisMismatch");
    expect(BACKEND_CODES).toContain("training.droppedFeatures");
  });

  it.each([...new Set(BACKEND_CODES)])("%s is a code the frontend can render", (code) => {
    expect(isKnownMessage({ code })).toBe(true);
  });

  it("renders every backend code as a real sentence in every language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const catalogue = messagesForLanguage(language);
      const t = (key: string) => catalogue[key];
      for (const code of new Set(BACKEND_CODES)) {
        const rendered = translateMessage({ code, detail: "diagnostic" }, t as never);
        expect(rendered, `${code} has no ${language} wording`).toBeTruthy();
        // The detail is the fallback for an unknown code. Seeing it here means the code was not
        // recognised, which is exactly the drift these tests exist to catch.
        expect(rendered, `${code} fell back to its English detail in ${language}`).not.toBe("diagnostic");
      }
    }
  });

  it("substitutes every placeholder a sentence declares", () => {
    // A `{count}` left in the rendered text is a parameter the backend never sent, or one it
    // sends under another name. Either way the user reads a brace.
    const parameters: Record<string, Record<string, string | number>> = {
      "dataset.excludedOtherBasis": { count: 5, excluded: "unrecorded", chosen: "wt%" },
      "concentration.incompatibleUnits": { subject: "Blend A", units: "mol%" },
      "concentration.mixedBases": { subject: "Blend A" },
      "concentration.partiallyRecordedWithin": {
        subject: "Blend A",
        recorded: "additives",
        recordedCount: 2,
        unrecordedCount: 1
      },
      "concentration.partiallyRecordedAcross": {
        subject: "Blend A",
        recorded: "additives",
        recordedCount: 2,
        unrecorded: "baseOils",
        unrecordedCount: 1
      },
      "concentration.nonPhysical": { subject: "Blend A", category: "additives", value: "-1" },
      "concentration.zeroTotal": { subject: "Blend A", category: "additives" },
      "concentration.basisMismatch": { subject: "Blend A", found: "wt%", expected: "none" },
      "training.droppedFeatures": { count: 3, features: "rdkit_MolWt" },
      "training.smallSample": { available: 14, required: 20 },
      "training.notScoreable": { heldOut: 5, distinct: 1 },
      "skipped.noDescriptors": { subject: "ZDDP", missingCount: 2 },
      "skipped.needsConcentration": { subject: "ZDDP", missingCount: 1 },
      "skipped.concentration": { subject: "ZDDP" },
      "skipped.missingFeatures": { subject: "Blend A", missingCount: 4 },
      "analysis.notEnoughData": {
        labelCode: "metric.averageFrictionCoefficient",
        required: 3,
        available: 1
      },
      "analysis.mixedUnits": { units: "wt%, ppm", count: 2 },
      "training.tooFewGroups": { groups: 3, required: 5 },
      "skipped.needsConditions": { subject: "ZDDP" },
      "design.noModel": { target: "Wear scar diameter" },
      "design.descriptorsUnavailable": { subject: "candidate 1" },
      "design.concentrationIncompatible": { subject: "candidate 1", basis: "wt%" },
      "design.conditionsRequired": { missing: "condition_temperature_c" },
      "design.testTypeIncompatible": { requested: "SRV", fitted: "four-ball" },
      "design.featuresMissing": { missingCount: 4 },
      "design.descriptorsOutOfRange": { count: 2, features: "rdkit_MolWt" },
      "design.testTypeNotCovered": { testType: "SRV" },
      "design.baseOilNotCovered": { baseOil: "PAO-6" },
      "design.concentrationNotCovered": { value: "5" },
      "design.conditionNotCovered": { condition: "temperature" },
      "design.conditionNotModelled": { conditions: "baseOil, temperature" },
      "design.identicalTrainingMolecule": { moleculeId: "mol-2" }
    };

    for (const language of SUPPORTED_LANGUAGES) {
      const catalogue = messagesForLanguage(language);
      const t = (key: string, values?: Record<string, string | number>) =>
        (catalogue[key] ?? "").replace(/\{(\w+)\}/g, (whole, name: string) =>
          values && name in values ? String(values[name]) : whole
        );
      for (const code of new Set(BACKEND_CODES)) {
        const rendered = translateMessage({ code, params: parameters[code] }, t as never);
        expect(rendered, `${code} leaves a placeholder unfilled in ${language}: ${rendered}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("shows an unknown code's detail rather than the code itself", () => {
    const t = ((key: string) => key) as never;
    // A backend newer than this build is not an error. Its diagnostic is still useful, and a
    // bracketed code on screen is not.
    expect(translateMessage({ code: "future.situation", detail: "Something specific." }, t)).toBe(
      "Something specific."
    );
    expect(translateMessage({ code: "future.situation" }, t)).toBe("");
  });
});

describe("backend error codes", () => {
  it("finds error codes from both Rust and Python", () => {
    expect(BACKEND_ERROR_CODES).toContain("model.unknownBasis");
    expect(BACKEND_ERROR_CODES).toContain("model.trainingFailed");
    expect(BACKEND_ERROR_CODES).toContain("file.alreadyExists");
  });

  it.each([...new Set(BACKEND_ERROR_CODES)])("%s has a frontend translation", (code) => {
    expect(isTranslatedCode(code)).toBe(true);
  });

  it("renders every error code in every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const catalogue = messagesForLanguage(language);
      const t = (key: string) => catalogue[key];
      for (const code of new Set(BACKEND_ERROR_CODES)) {
        const rendered = describeBackendError({ code, detail: "diagnostic" }, t as never);
        expect(rendered.summary, `${code} is untranslated in ${language}`).not.toBe(catalogue["error.unexpected"]);
        expect(rendered.detail).toBe("diagnostic");
      }
    }
  });
});
