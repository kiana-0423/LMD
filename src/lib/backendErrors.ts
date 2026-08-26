import type { MessageKey } from "../i18n/LanguageContext";

/**
 * The contract for errors a user reads.
 *
 * A backend error carries a stable code and an English detail: `[model.notFound] Model not
 * found: m-7`. The code names the situation and is what gets translated; the detail carries the
 * specifics — an id, a unit, a path, a SQLite message — and is shown as-is, because translating it
 * would mean translating values that came from the user's own data.
 *
 * An error with no code, or one this build does not recognise, is shown verbatim. Losing a
 * diagnostic to make an interface tidier is not a trade worth making.
 */
export type BackendError = {
  /** The stable code, when the message carried one. */
  code?: string;
  /** The English detail, always present. */
  detail: string;
};

type StructuredBackendError = {
  code?: unknown;
  detail?: unknown;
  message?: unknown;
  error?: unknown;
};

const CODED = /^\[([a-z][A-Za-z0-9.]*)\]\s*([\s\S]*)$/;

/** Attaches a code to a message the frontend itself raises, in the backend's format. */
export function coded(code: string, detail: string): string {
  return `[${code}] ${detail}`;
}

/** Splits a message into its code and its detail. */
export function parseBackendError(error: unknown): BackendError {
  if (error && typeof error === "object") {
    const structured = error as StructuredBackendError;
    // Python sidecar failures are JSON objects. Accept both the object itself and an envelope so
    // a future Tauri command can preserve the structure instead of flattening it to a string.
    if (structured.error !== undefined && structured.error !== null) {
      return parseBackendError(structured.error);
    }
    if (typeof structured.code === "string") {
      const detail =
        typeof structured.detail === "string"
          ? structured.detail
          : typeof structured.message === "string"
            ? structured.message
            : "";
      return { code: structured.code, detail };
    }
    if (!(error instanceof Error) && typeof structured.message === "string") {
      return parseBackendError(structured.message);
    }
  }
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = CODED.exec(text.trim());
  if (!match) return { detail: text };
  return { code: match[1], detail: match[2] };
}

/**
 * Every code this build can translate.
 *
 * Adding a code here is what makes a backend error localizable; leaving one out costs nothing but
 * the translation, because the detail is still shown.
 */
const TRANSLATED_CODES: Record<string, MessageKey> = {
  "model.basisMismatch": "error.modelBasisMismatch",
  "model.staleSchema": "error.modelStaleSchema",
  "model.wrongMode": "error.modelWrongMode",
  "model.notChosen": "error.modelNotChosen",
  "model.notFound": "error.modelNotFound",
  "model.fileMissing": "error.modelFileMissing",
  "model.notEnoughData": "error.modelNotEnoughData",
  "model.nothingToPredict": "error.modelNothingToPredict",
  "model.unknownBasis": "error.modelUnknownBasis",
  "model.trainingFailed": "error.modelTrainingFailed",
  "model.predictionFailed": "error.modelPredictionFailed",
  "model.loadFailed": "error.modelLoadFailed",
  "concentration.unusable": "error.concentrationUnusable",
  "descriptor.calculationFailed": "error.descriptorCalculationFailed",
  "structure.processingFailed": "error.structureProcessingFailed",
  "import.failed": "error.importFailed",
  "export.failed": "error.exportFailed",
  "file.alreadyExists": "error.fileAlreadyExists",
  "sidecar.invalidInput": "error.sidecarInvalidInput",
  "sidecar.dependencyUnavailable": "error.sidecarDependencyUnavailable",
  "sidecar.commandFailed": "error.sidecarCommandFailed",
  "sidecar.unavailable": "error.sidecarUnavailable",
  "sidecar.timeout": "error.sidecarTimeout",
  "sidecar.protocolFailed": "error.sidecarProtocolFailed",
  "workspace.pathRefused": "error.workspacePathRefused",
  "record.notFound": "error.recordNotFound",
  "app.desktopOnly": "error.desktopOnly",
  "app.selectionRequired": "error.selectionRequired",
  "sketcher.needsStructure": "error.sketcherNeedsStructure",
  "sketcher.needsCanonical": "error.sketcherNeedsCanonical",
  "sketcher.needsSmiles": "error.sketcherNeedsSmiles",
  "sketcher.invalidSmiles": "error.sketcherInvalidSmiles",
  "sketcher.descriptorFailed": "error.sketcherDescriptorFailed",
  "sketcher.saveFailed": "error.sketcherSaveFailed",
  "sketcher.saveCancelled": "error.sketcherSaveCancelled",
  // Write-payload validation. These fire before anything is stored, so the sentence a user reads
  // has to say that too — see the catalogue entries.
  "validation.nameRequired": "error.validationNameRequired",
  "validation.numberNotFinite": "error.validationNumberNotFinite",
  "validation.roleUnsupported": "error.validationRoleUnsupported",
  "validation.componentReference": "error.validationComponentReference",
  "validation.roleReferenceMismatch": "error.validationRoleReferenceMismatch",
  "validation.concentrationNotPositive": "error.validationConcentrationNotPositive",
  "validation.unitUnsupported": "error.validationUnitUnsupported",
  "validation.timeNegative": "error.validationTimeNegative",
  "validation.repeatCountInvalid": "error.validationRepeatCountInvalid",
  "validation.rangeInverted": "error.validationRangeInverted",
  "validation.payloadEmpty": "error.validationPayloadEmpty",
  // Referential safety.
  "delete.blockedByReferences": "error.deleteBlockedByReferences",
  "delete.cascadeNotConfirmed": "error.deleteCascadeNotConfirmed",
  // Workspace, backup and import.
  "backup.failed": "error.backupFailed",
  "restore.refused": "error.restoreRefused",
  "database.integrityFailed": "error.databaseIntegrityFailed",
  "workspace.unusable": "error.workspaceUnusable",
  "import.previewStale": "error.importPreviewStale"
};

/** True when this build has a translation for the code an error carries. */
export function isTranslatedCode(code: string | undefined): boolean {
  return Boolean(code && code in TRANSLATED_CODES);
}

/**
 * A localized summary plus the untouched detail.
 *
 * The summary is what the user reads first; the detail is what they act on, and what they can
 * quote when asking for help.
 */
export function describeBackendError(
  error: unknown,
  t: (key: MessageKey) => string
): { summary: string; detail: string } {
  const { code, detail } = parseBackendError(error);
  const key = code ? TRANSLATED_CODES[code] : undefined;
  if (!key) return { summary: t("error.unexpected"), detail };
  return { summary: t(key), detail };
}

/** One string for a toast, where there is no room for two lines. */
export function backendErrorText(error: unknown, t: (key: MessageKey) => string): string {
  const { summary, detail } = describeBackendError(error, t);
  return detail ? `${summary} ${detail}` : summary;
}
