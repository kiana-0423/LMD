import { additiveFunctionLabels, moleculeCategories, moleculeCategoryLabels } from "../../lib/constants";

export const moleculeEntryCategoryOptions = moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }));
export const moleculeEntryFunctionOptions = Object.entries(additiveFunctionLabels).map(([value, label]) => ({ value, label }));

export const saveSteps = [
  "Validate SMILES",
  "Generate 2D structure",
  "Generate 3D structure",
  "Calculate RDKit descriptors",
  "Calculate Mordred descriptors",
  "Save to SQLite"
];
