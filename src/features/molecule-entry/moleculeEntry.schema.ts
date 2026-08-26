import type { MessageKey } from "../../i18n/LanguageContext";
import { additiveFunctionLabelKeys, moleculeCategories, moleculeCategoryLabelKeys } from "../../lib/constants";

/**
 * The entry form's option lists, as `(value, key)` pairs.
 *
 * The label is resolved when the form renders, so switching language relabels the options; a
 * pre-built list of English labels could not.
 */
export const moleculeEntryCategoryOptions: { value: string; key: MessageKey }[] = moleculeCategories.map(
  (value) => ({ value, key: moleculeCategoryLabelKeys[value] })
);

export const moleculeEntryFunctionOptions: { value: string; key: MessageKey }[] = Object.entries(
  additiveFunctionLabelKeys
).map(([value, key]) => ({ value, key }));

/** The steps a save runs through, in order, as translation keys. */
export const saveStepKeys: MessageKey[] = [
  "ui.validateSmiles",
  "ui.generate2dStructure",
  "ui.generate3dStructure",
  "ui.calculateRdkitDescriptors",
  "ui.calculateMordredDescriptors",
  "ui.saveToSqlite"
];
