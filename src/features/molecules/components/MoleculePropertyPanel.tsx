import { additiveFunctionLabels, moleculeCategoryLabels } from "../../../lib/constants";
import type { Molecule } from "../../../types";

function Field({ label, value, full }: { label: string; value?: string | number | boolean; full?: boolean }) {
  return (
    <div className={full ? "drawer-key full" : "drawer-key"}>
      <label>{label}</label>
      <strong className={String(value).length > 40 ? "mono" : undefined}>{String(value ?? "-")}</strong>
    </div>
  );
}

export default function MoleculePropertyPanel({ molecule }: { molecule: Molecule }) {
  const functionTags = molecule.additiveFunctionTags.map((tag) => additiveFunctionLabels[tag] ?? tag).join(", ");

  return (
    <div className="drawer-key-grid">
      <Field label="Name" value={molecule.name} />
      <Field label="Category" value={moleculeCategoryLabels[molecule.category] ?? molecule.category} />
      <Field label="SMILES" value={molecule.smilesRaw} full />
      <Field label="Canonical SMILES" value={molecule.smilesCanonical} full />
      <Field label="InChI" value={molecule.inchi} full />
      <Field label="InChIKey" value={molecule.inchiKey} />
      <Field label="Molecular Formula" value={molecule.formula} />
      <Field label="Molecular Weight" value={molecule.molecularWeight} />
      <Field label="Additive Function Tags" value={functionTags || "-"} />
      <Field label="Data Source" value={molecule.dataSource} />
      <Field label="Created from Ketcher" value={molecule.source === "ketcher" ? "Yes" : "No"} />
      <Field label="Import Mode" value={molecule.importMode || "manual_save"} />
      <Field label="Imported as New Molecule" value={molecule.importMode === "new_import" || molecule.importMode === "new_copy" ? "Yes" : "No"} />
      <Field label="duplicate of molecule_id" value={molecule.duplicateOf || "-"} />
      <Field label="Notes" value={molecule.notes} full />
    </div>
  );
}
