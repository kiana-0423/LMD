import type { MessageKey, MessageParams, Translate } from "../i18n/LanguageContext";

/**
 * Interface text the backend produced, rendered in the user's language.
 *
 * [`backendErrors`](./backendErrors.ts) handles a message with no moving parts: a code, and prose
 * behind it. Most of what the backend says is not like that. *"5 record(s) recorded concentrations
 * as 'unrecorded' while the dataset settled on 'wt%'"* is a count and two bases, and the order the
 * pieces fall in is different in Chinese from English. Concatenating translated fragments produces
 * a sentence in no language at all.
 *
 * So the backend sends the sentence taken apart — a `code`, the `params` it needs, and an
 * untranslated `detail` — and this module puts it back together in whichever language is current.
 *
 * Three rules the whole design rests on:
 *
 *  - **A code this build does not know is not an error.** Its `detail` is shown verbatim. Losing a
 *    diagnostic to keep an interface tidy is not a trade worth making, and it means a new backend
 *    message never has to wait for a translation to be useful.
 *  - **User data is never translated.** A molecule's name, a unit the user typed, a file path, a
 *    SQLite error: these arrive as parameters and are substituted as they are.
 *  - **A token is not a word.** `baseOils` and `wt%` arrive as tokens precisely so the sentence can
 *    say 基础油 — the backend names the concept and the catalogue holds the wording.
 */
export type BackendMessage = {
  /** Which sentence this is. */
  code?: string;
  /** The values the sentence needs. */
  params?: Record<string, string | number>;
  /** English diagnostic, shown when there is no translation and alongside one that has specifics. */
  detail?: string;
};

/** Every message code this build can render as a sentence. */
const MESSAGE_KEYS: Record<string, MessageKey> = {
  "dataset.excludedOtherBasis": "backend.datasetExcludedOtherBasis",
  "dataset.unrecordedBasis": "backend.datasetUnrecordedBasis",
  "dataset.noConcentrations": "backend.datasetNoConcentrations",
  "dataset.unknownBasis": "backend.datasetUnknownBasis",
  "dataset.unusableRecord": "backend.datasetUnusableRecord",
  "dataset.cleanupFailed": "backend.datasetCleanupFailed",
  "dataset.interpretationAdditive": "backend.interpretationAdditive",
  "dataset.interpretationAggregate": "backend.interpretationAggregate",

  "concentration.incompatibleUnits": "backend.concentrationIncompatibleUnits",
  "concentration.mixedBases": "backend.concentrationMixedBases",
  "concentration.partiallyRecordedWithin": "backend.concentrationPartialWithin",
  "concentration.partiallyRecordedAcross": "backend.concentrationPartialAcross",
  "concentration.nonPhysical": "backend.concentrationNonPhysical",
  "concentration.zeroTotal": "backend.concentrationZeroTotal",
  "concentration.basisMismatch": "backend.concentrationBasisMismatch",

  "split.grouped": "backend.splitGrouped",
  "split.ungrouped": "backend.splitUngrouped",
  "split.none": "backend.splitNone",
  "split.notScoreable": "backend.splitNotScoreable",
  "split.unknown": "backend.splitUnknown",
  "split.groupedLinked": "backend.splitGroupedLinked",

  "training.droppedFeatures": "backend.trainingDroppedFeatures",
  "training.ungroupedSplit": "backend.trainingUngroupedSplit",
  "training.smallSample": "backend.trainingSmallSample",
  "training.notScoreable": "backend.trainingNotScoreable",
  "training.tooFewGroups": "backend.trainingTooFewGroups",
  "training.formulationGroupsOnly": "backend.trainingFormulationGroupsOnly",

  "skipped.noDescriptors": "backend.skippedNoDescriptors",
  "skipped.needsConcentration": "backend.skippedNeedsConcentration",
  "skipped.concentration": "backend.skippedConcentration",
  "skipped.missingFeatures": "backend.skippedMissingFeatures",
  "skipped.needsConditions": "backend.skippedNeedsConditions",

  "design.structureInvalid": "backend.designStructureInvalid",
  "design.noModel": "backend.designNoModel",
  "design.descriptorsUnavailable": "backend.designDescriptorsUnavailable",
  "design.concentrationIncompatible": "backend.designConcentrationIncompatible",
  "design.conditionsRequired": "backend.designConditionsRequired",
  "design.testTypeIncompatible": "backend.designTestTypeIncompatible",
  "design.featuresMissing": "backend.designFeaturesMissing",
  "design.domainNotRecorded": "backend.designDomainNotRecorded",
  "design.descriptorsOutOfRange": "backend.designDescriptorsOutOfRange",
  "design.testTypeNotCovered": "backend.designTestTypeNotCovered",
  "design.baseOilNotCovered": "backend.designBaseOilNotCovered",
  "design.concentrationNotCovered": "backend.designConcentrationNotCovered",
  "design.conditionNotCovered": "backend.designConditionNotCovered",
  "design.noHeldOutValidation": "backend.designNoHeldOutValidation",
  "design.validationNotMoleculeGrouped": "backend.designValidationNotMoleculeGrouped",
  "design.validationUngrouped": "backend.designValidationUngrouped",
  "design.multiAdditiveTraining": "backend.designMultiAdditiveTraining",
  "design.conditionNotModelled": "backend.designConditionNotModelled",
  "design.identicalTrainingMolecule": "backend.designIdenticalTrainingMolecule",

  "analysis.notEnoughData": "backend.analysisNotEnoughData",
  "analysis.methodHistogram": "backend.analysisMethodHistogram",
  "analysis.methodGrouped": "backend.analysisMethodGrouped",
  "analysis.methodPaired": "backend.analysisMethodPaired",
  "analysis.methodCorrelation": "backend.analysisMethodCorrelation",
  "analysis.missingExcluded": "backend.analysisMissingExcluded",
  "analysis.missingPairExcluded": "backend.analysisMissingPairExcluded",
  "analysis.mixedUnits": "backend.analysisMixedUnits"
};

/** How a concentration basis is named in a sentence. */
const BASIS_KEYS: Record<string, MessageKey> = {
  "wt%": "model.basisMass",
  unrecorded: "model.basisUnrecorded",
  none: "model.basisNone"
};

/** How a side of a blend is named in a sentence. */
const CATEGORY_KEYS: Record<string, MessageKey> = {
  additives: "formulation.additives",
  baseOils: "formulation.baseOil"
};

/**
 * Parameters that arrive as tokens and must be translated before substitution.
 *
 * Everything not listed here is the user's own data and is substituted unchanged. That is the
 * safer default: translating a molecule name or a unit would corrupt what the user recorded,
 * while leaving a token untranslated is merely ugly.
 */
/** How a condition is named in a sentence. */
const CONDITION_KEYS: Record<string, MessageKey> = {
  temperature: "design.conditionTemperature",
  load: "design.conditionLoad"
};

const TOKEN_PARAMS: Record<string, Record<string, MessageKey>> = {
  condition: CONDITION_KEYS,
  basis: BASIS_KEYS,
  category: CATEGORY_KEYS,
  recorded: CATEGORY_KEYS,
  unrecorded: CATEGORY_KEYS,
  excluded: BASIS_KEYS,
  chosen: BASIS_KEYS,
  found: BASIS_KEYS,
  expected: BASIS_KEYS
};

/** True when this build can render the code as a sentence. */
export function isKnownMessage(message: BackendMessage | undefined): boolean {
  return Boolean(message?.code && message.code in MESSAGE_KEYS);
}

function resolveParams(message: BackendMessage, t: Translate): MessageParams {
  const resolved: MessageParams = {};
  for (const [name, value] of Object.entries(message.params ?? {})) {
    const tokens = TOKEN_PARAMS[name];
    const key = tokens && typeof value === "string" ? tokens[value] : undefined;
    resolved[name] = key ? t(key) : value;
  }
  // `labelCode` is itself a translation key: a performance metric named by the backend.
  const labelCode = message.params?.labelCode;
  if (typeof labelCode === "string") {
    resolved.label = t(labelCode as MessageKey);
  }
  return resolved;
}

/**
 * The sentence, in the current language.
 *
 * Returns the untranslated detail when the code is unknown, and an empty string when there is
 * neither — never a code in brackets, which is not something anyone can act on.
 */
export function translateMessage(
  message: BackendMessage | string | undefined,
  t: Translate
): string {
  if (!message) return "";
  if (typeof message === "string") return message;
  const key = message.code ? MESSAGE_KEYS[message.code] : undefined;
  if (!key) return message.detail ?? "";
  return t(key, resolveParams(message, t));
}

/**
 * The sentence plus its diagnostic, for a place with room for both.
 *
 * The detail repeats what the sentence says, in English, with the exact values — which is what a
 * user quotes when asking for help, and what a developer needs when the translation turns out to
 * be misleading.
 */
export function describeMessage(
  message: BackendMessage | string | undefined,
  t: Translate
): { text: string; detail: string } {
  if (typeof message === "string") return { text: message, detail: "" };
  const text = translateMessage(message, t);
  const detail = isKnownMessage(message) ? (message?.detail ?? "") : "";
  return { text, detail };
}

/** Renders a list of backend messages, dropping any that come back empty. */
export function translateMessages(
  messages: (BackendMessage | string)[] | undefined,
  t: Translate
): string[] {
  return (messages ?? []).map((message) => translateMessage(message, t)).filter(Boolean);
}
