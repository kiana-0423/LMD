import { additiveFunctionLabelKeys, moleculeCategoryLabelKeys } from "../../../lib/constants";
import type { Molecule } from "../../../types";
import { useLanguage } from "../../../i18n/LanguageContext";

function Field({
  label,
  value,
  full,
  translatable = false
}: {
  label: string;
  value?: string | number | boolean;
  full?: boolean;
  translatable?: boolean;
}) {
  return (
    <div className={full ? "drawer-key full" : "drawer-key"}>
      <label>{label}</label>
      <strong
        className={String(value).length > 40 ? "mono" : undefined}
        translate={translatable ? "yes" : "no"}
      >
        {String(value ?? "-")}
      </strong>
    </div>
  );
}

export default function MoleculePropertyPanel({ molecule }: { molecule: Molecule }) {
  const { t } = useLanguage();
  const functionTags = molecule.additiveFunctionTags
    .map((tag) => (additiveFunctionLabelKeys[tag] ? t(additiveFunctionLabelKeys[tag]) : tag))
    .join(", ");

  return (
    <div className="drawer-key-grid">
      <Field label={t("ui.name")} value={molecule.name} />
      <Field label={t("ui.category")} value={moleculeCategoryLabelKeys[molecule.category] ? t(moleculeCategoryLabelKeys[molecule.category]) : molecule.category} translatable />
      <Field label="SMILES" value={molecule.smilesRaw} full />
      <Field label={t("ui.canonicalSmiles")} value={molecule.smilesCanonical} full />
      <Field label="InChI" value={molecule.inchi} full />
      <Field label="InChIKey" value={molecule.inchiKey} />
      <Field label={t("ui.molecularFormula")} value={molecule.formula} />
      <Field label={t("ui.molecularWeight")} value={molecule.molecularWeight} />
      <Field label={t("ui.additiveFunctionTags")} value={functionTags || "-"} translatable />
      <Field label={t("ui.dataSource")} value={molecule.dataSource} />
      <Field label={t("ui.createdFromKetcher")} value={molecule.source === "ketcher" ? t("ui.yes"): t("ui.no")} translatable />
      <Field label={t("ui.importMode")} value={molecule.importMode || "manual_save"} />
      <Field label={t("ui.importedAsNewMolecule")} value={molecule.importMode === "new_import" || molecule.importMode === "new_copy" ? t("ui.yes"): t("ui.no")} translatable />
      <Field label={t("ui.duplicateOfMoleculeId")} value={molecule.duplicateOf || "-"} />
      <Field label={t("ui.notes")} value={molecule.notes} full />
    </div>
  );
}
