import { describe, expect, it } from "vitest";
import {
  backendErrorText,
  coded,
  describeBackendError,
  isTranslatedCode,
  parseBackendError
} from "../lib/backendErrors";
import { SUPPORTED_LANGUAGES, type MessageKey } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

const t = (key: MessageKey) => messagesForLanguage("en-US")[key];

describe("backend error codes", () => {
  it("splits a coded message into its code and its detail", () => {
    const parsed = parseBackendError(new Error("[model.notFound] Model not found: m-7"));

    expect(parsed.code).toBe("model.notFound");
    // The detail is what makes the error actionable, so it survives verbatim.
    expect(parsed.detail).toBe("Model not found: m-7");
  });

  it("keeps an uncoded message whole", () => {
    const parsed = parseBackendError(new Error("database is locked"));

    expect(parsed.code).toBeUndefined();
    expect(parsed.detail).toBe("database is locked");
  });

  it("reads a structured sidecar error and its envelope", () => {
    const structured = {
      error: {
        code: "model.trainingFailed",
        params: { command: "train-model" },
        detail: "At least three rows are required."
      }
    };

    expect(parseBackendError(structured)).toEqual({
      code: "model.trainingFailed",
      detail: "At least three rows are required."
    });
    expect(parseBackendError({ error: "[file.alreadyExists] /tmp/out.csv" })).toEqual({
      code: "file.alreadyExists",
      detail: "/tmp/out.csv"
    });
  });

  it("round-trips a code the frontend raises itself", () => {
    const parsed = parseBackendError(new Error(coded("app.desktopOnly", "Attaching copies a file.")));

    expect(parsed.code).toBe("app.desktopOnly");
    expect(parsed.detail).toBe("Attaching copies a file.");
  });

  it("translates a known code and preserves the detail beside it", () => {
    const { summary, detail } = describeBackendError(
      new Error("[concentration.unusable] 'Blend 3' records concentrations in mol%."),
      t
    );

    expect(summary).toBe(t("error.concentrationUnusable"));
    expect(detail).toBe("'Blend 3' records concentrations in mol%.");
    expect(summary).not.toContain("mol%");
  });

  it("shows an unrecognised code's message rather than losing it", () => {
    // Dropping a diagnostic to keep an interface tidy is not a trade worth making.
    const { summary, detail } = describeBackendError(new Error("[future.code] something specific"), t);

    expect(summary).toBe(t("error.unexpected"));
    expect(detail).toBe("something specific");
    expect(backendErrorText(new Error("[future.code] something specific"), t)).toContain("something specific");
  });

  it("reports which codes this build can translate", () => {
    expect(isTranslatedCode("model.notFound")).toBe(true);
    expect(isTranslatedCode("model.doesNotExistYet")).toBe(false);
    expect(isTranslatedCode(undefined)).toBe(false);
  });

  it("has a translation for every code in every language", () => {
    const codes = [
      "model.basisMismatch",
      "model.staleSchema",
      "model.wrongMode",
      "model.notChosen",
      "model.notFound",
      "model.fileMissing",
      "model.notEnoughData",
      "model.nothingToPredict",
      "model.unknownBasis",
      "model.trainingFailed",
      "model.predictionFailed",
      "model.loadFailed",
      "concentration.unusable",
      "descriptor.calculationFailed",
      "structure.processingFailed",
      "import.failed",
      "export.failed",
      "file.alreadyExists",
      "sidecar.invalidInput",
      "sidecar.dependencyUnavailable",
      "sidecar.commandFailed",
      "sidecar.unavailable",
      "sidecar.timeout",
      "sidecar.protocolFailed",
      "workspace.pathRefused",
      "record.notFound",
      "app.desktopOnly",
      "app.selectionRequired",
      "sketcher.needsStructure",
      "sketcher.needsCanonical",
      "sketcher.needsSmiles",
      "sketcher.invalidSmiles",
      "sketcher.descriptorFailed",
      "sketcher.saveFailed",
      "sketcher.saveCancelled"
    ];

    for (const language of SUPPORTED_LANGUAGES) {
      const messages = messagesForLanguage(language);
      const translate = (key: MessageKey) => messages[key];
      for (const code of codes) {
        expect(isTranslatedCode(code), `${code} has no mapping`).toBe(true);
        const { summary } = describeBackendError(new Error(`[${code}] detail`), translate);
        // A code that fell through to the generic message is one the mapping forgot.
        expect(summary, `${code} is untranslated in ${language}`).not.toBe(messages["error.unexpected"]);
        expect(summary.length).toBeGreaterThan(0);
      }
    }
  });
});
