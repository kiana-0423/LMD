import type { ApplicationContext, CandidateConstraints, DesignRequest, SeedRequest, SubstituentConstraints } from "../../lib/api";
import { SUBSTITUENT_TYPES } from "../../lib/designPolicy";

/**
 * The editable state behind a design request, kept as three separate dimensions.
 *
 * Nothing here is defaulted on the user's behalf where a value would be a scientific claim: the
 * target function and metric start empty, and every application condition starts blank. The
 * structural controls do carry defaults, because a substituent size limit is a bound on a search
 * rather than a statement about a material.
 */
export type ChemicalClassState = {
  templateId: string;
  constraints: SubstituentConstraints;
  candidateConstraints: CandidateConstraints;
  substituentSources: string[];
  /** `undefined` means every curated substituent; a list restricts to those ids. */
  curatedSubstituentIds?: string[];
  identicalSubstituents: boolean;
  maxCandidates: number;
  randomSeed: number | null;
  seeds: SeedRequest[];
};

export type TargetState = { targetFunction: string; targetMetric: string };

export const DEFAULT_CONSTRAINTS: SubstituentConstraints = {
  permittedElements: ["C", "H", "O"],
  allowedTypes: [...SUBSTITUENT_TYPES],
  minHeavyAtoms: 2,
  maxHeavyAtoms: 20,
  maxBranchPoints: 3
};

export const DEFAULT_CHEMICAL_CLASS: ChemicalClassState = {
  templateId: "",
  constraints: DEFAULT_CONSTRAINTS,
  candidateConstraints: {
    permittedElements: ["C", "H", "B", "N", "O", "F", "Si", "P", "S", "Cl", "Br"],
    minHeavyAtoms: 2,
    maxHeavyAtoms: 60,
    maxBranchPoints: 10
  },
  substituentSources: ["curated"],
  curatedSubstituentIds: undefined,
  identicalSubstituents: false,
  maxCandidates: 50,
  randomSeed: 42,
  seeds: []
};

export const DEFAULT_TARGET: TargetState = { targetFunction: "", targetMetric: "" };

export const DEFAULT_CONTEXT: ApplicationContext = {
  baseOilId: "",
  baseOilName: "",
  concentration: undefined,
  concentrationUnit: "wt%",
  otherComponents: "",
  testType: "",
  temperatureValue: undefined,
  temperatureUnit: "°C",
  loadValue: undefined,
  loadUnit: "N",
  notes: ""
};

export function buildDesignRequest(
  chemicalClass: ChemicalClassState,
  target: TargetState,
  context: ApplicationContext,
  name: string
): DesignRequest {
  return {
    name,
    templateId: chemicalClass.templateId,
    constraints: chemicalClass.constraints,
    candidateConstraints: chemicalClass.candidateConstraints,
    substituentSources: chemicalClass.templateId ? chemicalClass.substituentSources : ["brics"],
    curatedSubstituentIds: chemicalClass.templateId ? chemicalClass.curatedSubstituentIds ?? null : null,
    identicalSubstituents: chemicalClass.templateId ? chemicalClass.identicalSubstituents : false,
    maxCandidates: chemicalClass.maxCandidates,
    randomSeed: chemicalClass.randomSeed,
    seeds: chemicalClass.seeds,
    targetFunction: target.targetFunction,
    targetMetric: target.targetMetric,
    context: cleanContext(context)
  };
}

/** Drops blank strings so the backend records "not given" rather than an empty value. */
export function cleanContext(context: ApplicationContext): ApplicationContext {
  const cleaned: ApplicationContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === "") continue;
    (cleaned as Record<string, unknown>)[key] = value;
  }
  // A unit without a value says nothing; drop it so the backend does not read a unit-only field.
  if (cleaned.concentration === undefined) delete cleaned.concentrationUnit;
  if (cleaned.temperatureValue === undefined) delete cleaned.temperatureUnit;
  if (cleaned.loadValue === undefined) delete cleaned.loadUnit;
  return cleaned;
}
