import type { MessageKey } from "../i18n/LanguageContext";
import type { MoleculeCategory } from "../types";

export const APP_NAME = "LMD";
export const APP_NAME_CN = "LMD";

/**
 * The routes the application exposes, with the key each one's label comes from.
 *
 * Keys rather than words: a manifest of English labels would be the one place the language switch
 * could not reach.
 */
export const formalRoutes = [
  { key: "/dashboard", labelKey: "menu.dashboard", group: "menu.dashboardGroup" },
  { key: "/molecules", labelKey: "menu.molecules", group: "menu.database" },
  { key: "/descriptors", labelKey: "menu.descriptors", group: "menu.database" },
  { key: "/base-additive", labelKey: "menu.baseAdditive", group: "menu.database" },
  { key: "/formulations", labelKey: "menu.formulations", group: "menu.database" },
  { key: "/experiments", labelKey: "menu.experiments", group: "menu.database" },
  { key: "/molecule-entry", labelKey: "menu.moleculeEntry", group: "menu.input" },
  { key: "/molecule-sketcher", labelKey: "menu.moleculeSketcher", group: "menu.input" },
  { key: "/data-mining/molecule-performance", labelKey: "menu.moleculePerformance", group: "menu.dataMining" },
  { key: "/data-mining/formulation-prediction", labelKey: "menu.formulationPrediction", group: "menu.dataMining" },
  { key: "/data-mining/molecule-design", labelKey: "menu.molecularDesign", group: "menu.dataMining" },
  { key: "/import-export", labelKey: "menu.importExport", group: "menu.system" }
] as const satisfies readonly { key: string; labelKey: MessageKey; group: MessageKey }[];

export const moleculeCategories: MoleculeCategory[] = [
  "base_oil_representative",
  "additive",
  "solvent",
  "candidate",
  "other"
];

export const additiveFunctionTags = [
  "antioxidant",
  "antiwear",
  "extreme_pressure",
  "friction_modifier",
  "corrosion_inhibitor",
  "dispersant",
  "detergent",
  "viscosity_modifier",
  "pour_point_depressant"
];

/**
 * Interface labels for stored codes, as translation keys rather than English text.
 *
 * A stored value like `antiwear` is data; the words a user reads for it are interface text, and
 * have to follow the language switch. Keeping the key here means every screen that renders one of
 * these codes shows the same wording.
 */
export const moleculeCategoryLabelKeys: Record<MoleculeCategory, MessageKey> = {
  base_oil_representative: "label.baseOilRepresentative",
  additive: "label.additive",
  solvent: "label.solvent",
  candidate: "label.candidate",
  other: "label.other",
};

export const additiveFunctionLabelKeys: Record<string, MessageKey> = {
  antioxidant: "label.antioxidant",
  antiwear: "label.antiwearAgent",
  extreme_pressure: "label.extremePressureAgent",
  friction_modifier: "label.frictionModifier",
  corrosion_inhibitor: "label.corrosionInhibitor",
  dispersant: "label.dispersant",
  detergent: "label.detergent",
  viscosity_modifier: "label.viscosityIndexImprover",
  pour_point_depressant: "label.pourPointDepressant",
};

/**
 * Descriptor and job states. `partial` and `interrupted` matter: a batch that half-failed is not a
 * success, and a job the application never closed is not still running.
 */
export const descriptorStatusLabelKeys: Record<string, MessageKey> = {
  running: "label.running",
  succeeded: "label.succeeded",
  partial: "label.partial",
  interrupted: "label.interrupted",
  calculated: "label.calculated",
  mock: "label.mock",
  failed: "label.failed",
  pending: "label.pending",
  missing: "label.missing",
  real: "label.live",
  ready: "label.ready",
  attention: "label.needsAttention",
};

export const commonOptionLabelKeys: Record<string, MessageKey> = {
  base_oil: "label.baseOil",
  additive: "label.additive",
  solvent: "label.solvent",
  other: "label.other",
  stirring: "label.stirring",
  ultrasonication: "label.ultrasonication",
  heating: "label.heating",
  "rdkit only": "label.rdkitOnly",
  "mordred only": "label.mordredOnly",
  both: "label.rdkitMordred",
  balanced: "label.balanced",
  "minimum friction": "label.minimumFriction",
  "minimum wear": "label.minimumWear",
  "oxidation stability": "label.oxidationStability",
  "low friction coefficient": "label.lowFrictionCoefficient",
  "small wear scar": "label.smallWearScar",
  "high oxidation temperature": "label.highOxidationTemperature",
  "high extreme pressure value": "label.highExtremePressureValue",
  "mass fraction": "label.massFraction",
};

export const descriptorSummaryKeys = [
  "MolWt",
  "MolLogP",
  "TPSA",
  "NumHDonors",
  "NumHAcceptors",
  "NumRotatableBonds",
  "RingCount",
  "HeavyAtomCount",
  "NumHeteroatoms",
  "Element_C",
  "Element_H",
  "Element_O",
  "Element_N",
  "Element_S",
  "Element_P"
];
