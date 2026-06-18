import { additiveFunctionLabels, moleculeCategories, moleculeCategoryLabels } from "../../lib/constants";

export const moleculeEntryCategoryOptions = moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }));
export const moleculeEntryFunctionOptions = Object.entries(additiveFunctionLabels).map(([value, label]) => ({ value, label }));

export const saveSteps = [
  "校验 SMILES",
  "生成 2D 结构",
  "生成 3D 结构",
  "计算 RDKit 描述符",
  "计算 Mordred 描述符",
  "保存到 SQLite"
];
