import type { MoleculeCategory } from "../types";

export const APP_NAME = "LMD";
export const APP_NAME_CN = "LMD";

export const formalRoutes = [
  { key: "/dashboard", label: "Dashboard", group: "Dashboard" },
  { key: "/molecules", label: "Molecule Library", group: "Database" },
  { key: "/descriptors", label: "Descriptor Center", group: "Database" },
  { key: "/base-additive", label: "Base Oils / Additives", group: "Database" },
  { key: "/formulations", label: "Formulation Library", group: "Database" },
  { key: "/experiments", label: "Experiments & Performance", group: "Database" },
  { key: "/molecule-entry", label: "Molecule Entry", group: "Data Entry" },
  { key: "/molecule-sketcher", label: "Molecule Sketcher", group: "Data Entry" },
  { key: "/formulation-entry", label: "Formulation Entry", group: "Data Entry" },
  { key: "/data-mining/molecule-performance", label: "Molecule Performance", group: "Data Mining" },
  { key: "/data-mining/formulation-prediction", label: "Formulation Prediction", group: "Data Mining" },
  { key: "/data-mining/molecule-design", label: "Molecule Design", group: "Data Mining" },
  { key: "/import-export", label: "Import / Export", group: "System" }
] as const;

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

export const moleculeCategoryLabels: Record<MoleculeCategory, string> = {
  base_oil_representative: "Base-oil representative",
  additive: "Additive",
  solvent: "Solvent",
  candidate: "Candidate",
  other: "Other"
};

export const additiveFunctionLabels: Record<string, string> = {
  antioxidant: "Antioxidant",
  antiwear: "Antiwear agent",
  extreme_pressure: "Extreme-pressure agent",
  friction_modifier: "Friction modifier",
  corrosion_inhibitor: "Corrosion inhibitor",
  dispersant: "Dispersant",
  detergent: "Detergent",
  viscosity_modifier: "Viscosity-index improver",
  pour_point_depressant: "Pour-point depressant"
};

export const descriptorStatusLabels: Record<string, string> = {
  calculated: "Calculated",
  mock: "Mock",
  failed: "Failed",
  pending: "Pending",
  missing: "Missing",
  real: "Live",
  ready: "Ready",
  attention: "Needs attention"
};

export const commonOptionLabels: Record<string, string> = {
  base_oil: "Base oil",
  additive: "Additive",
  solvent: "Solvent",
  other: "Other",
  stirring: "Stirring",
  ultrasonication: "Ultrasonication",
  heating: "Heating",
  "rdkit only": "RDKit only",
  "mordred only": "Mordred only",
  both: "RDKit + Mordred",
  balanced: "Balanced",
  "minimum friction": "Minimum friction",
  "minimum wear": "Minimum wear",
  "oxidation stability": "Oxidation stability",
  "low friction coefficient": "Low friction coefficient",
  "small wear scar": "Small wear scar",
  "high oxidation temperature": "High oxidation temperature",
  "high extreme pressure value": "High extreme-pressure value",
  "mass fraction": "Mass fraction"
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
