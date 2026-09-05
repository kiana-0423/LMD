import type { MessageKey } from "../i18n/LanguageContext";
import type { DatasetScope } from "./api/model";
import type { AssessmentStatus, ConditionHandling, CoverageStatus, VerificationStatus } from "./api/design";

/**
 * The closed vocabularies of the molecular-design workflow, and the interface label for each.
 *
 * Every value here is a stored code — a substituent type, an assessment status, a verification
 * state — and every code has a translation key, so the same word is used for it on every screen
 * and in every language. Nothing here is a threshold: the statuses are decided by the backend
 * from evidence it reports alongside them.
 */

export const SUBSTITUENT_TYPES = [
  "linear_alkyl",
  "branched_alkyl",
  "alkenyl",
  "cycloalkyl",
  "aryl",
  "alkylaryl",
  "aralkyl",
  "heteroatom_alkyl"
] as const;

export const SELECTABLE_ELEMENTS = ["C", "H", "O", "N", "S", "F", "Cl", "Br", "Si"] as const;

export const SUBSTITUENT_SOURCES = ["curated", "seed_substituents", "brics"] as const;

export const VERIFICATION_STATUSES: VerificationStatus[] = ["not_verified", "planned", "verified", "refuted"];

export const DEFAULT_DATASET_SCOPE: DatasetScope = {
  singleAdditiveOnly: false,
  testType: "",
  includeConditionFeatures: false
};

/** The condition features a model may carry, by name. */
export const CONDITION_FEATURES = ["condition_temperature_c", "condition_load_n"] as const;

/** True when a model's columns include the test temperature and load. */
export function modelUsesConditions(model: { featureOrder?: string[] } | undefined) {
  return Boolean(
    model?.featureOrder?.some((name) => (CONDITION_FEATURES as readonly string[]).includes(name))
  );
}

/** The temperature and load units this build converts. Anything else is refused, not guessed. */
export const TEMPERATURE_UNITS = ["°C", "K", "°F"] as const;
export const LOAD_UNITS = ["N", "kN", "kgf", "lbf"] as const;

export const substituentTypeLabelKeys: Record<string, MessageKey> = {
  brics_fragment: "design.bricsFragment",
  linear_alkyl: "design.typeLinearAlkyl",
  branched_alkyl: "design.typeBranchedAlkyl",
  alkenyl: "design.typeAlkenyl",
  cycloalkyl: "design.typeCycloalkyl",
  aryl: "design.typeAryl",
  alkylaryl: "design.typeAlkylaryl",
  aralkyl: "design.typeAralkyl",
  heteroatom_alkyl: "design.typeHeteroatomAlkyl"
};

export const substituentSourceLabelKeys: Record<string, MessageKey> = {
  curated: "design.sourceCurated",
  seed_substituents: "design.sourceSeedSubstituents",
  brics: "design.sourceBrics"
};

export const templateLabelKeys: Record<string, MessageKey> = {
  phosphate_monoester: "design.templatePhosphateMonoester",
  phosphate_diester: "design.templatePhosphateDiester",
  phosphate_triester: "design.templatePhosphateTriester"
};

export const chemicalClassLabelKeys: Record<string, MessageKey> = {
  organophosphate: "design.classOrganophosphate",
  phosphate_ester: "design.classPhosphateEster",
  phosphate_monoester: "design.templatePhosphateMonoester",
  phosphate_diester: "design.templatePhosphateDiester",
  phosphate_triester: "design.templatePhosphateTriester",
  alkyl_phosphate: "design.classAlkylPhosphate",
  aryl_phosphate: "design.classArylPhosphate",
  mixed_alkyl_aryl_phosphate: "design.classMixedPhosphate",
  acid_phosphate: "design.classAcidPhosphate"
};

export const assessmentStatusLabelKeys: Record<AssessmentStatus, MessageKey> = {
  supported: "design.statusSupported",
  exploratory: "design.statusExploratory",
  unavailable: "design.statusUnavailable"
};

export const assessmentStatusHelpKeys: Record<AssessmentStatus, MessageKey> = {
  supported: "design.statusSupportedHelp",
  exploratory: "design.statusExploratoryHelp",
  unavailable: "design.statusUnavailableHelp"
};

export function assessmentStatusColor(status: AssessmentStatus | undefined) {
  if (status === "supported") return "green";
  if (status === "exploratory") return "gold";
  return "red";
}

export const verificationLabelKeys: Record<VerificationStatus, MessageKey> = {
  not_verified: "design.verificationNotVerified",
  planned: "design.verificationPlanned",
  verified: "design.verificationVerified",
  refuted: "design.verificationRefuted"
};

export const conditionHandlingLabelKeys: Record<ConditionHandling[keyof ConditionHandling], MessageKey> = {
  feature: "design.handlingFeature",
  notUsed: "design.handlingNotUsed",
  scopeFilter: "design.handlingScopeFilter",
  coverageOnly: "design.handlingCoverageOnly",
  recordedOnly: "design.handlingRecordedOnly"
};

export const coverageStatusLabelKeys: Record<CoverageStatus, MessageKey> = {
  covered: "design.coverageCovered",
  notCovered: "design.coverageNotCovered",
  notRequested: "design.coverageNotRequested",
  notRecorded: "design.coverageNotRecorded",
  recordedOnly: "design.handlingRecordedOnly"
};

export const validationSupportLabelKeys: Record<string, MessageKey> = {
  unseenMolecules: "design.supportUnseenMolecules",
  formulationsOnly: "design.supportFormulationsOnly",
  ungrouped: "design.supportUngrouped",
  none: "design.supportNone"
};

export const domainStatusLabelKeys: Record<string, MessageKey> = {
  within: "design.domainWithin",
  outside: "design.domainOutside",
  unknown: "design.domainUnknown"
};

export const splitGroupingLabelKeys: Record<string, MessageKey> = {
  linked: "design.groupingLinked",
  formulation: "design.groupingFormulation",
  ungrouped: "design.groupingUngrouped",
  none: "design.groupingNone"
};

export const conditionNameKeys: Record<string, MessageKey> = {
  concentration: "model.concentration",
  testType: "design.testType",
  baseOil: "formulation.baseOil",
  temperature: "design.conditionTemperature",
  load: "design.conditionLoad",
  otherComponents: "design.otherComponents"
};
