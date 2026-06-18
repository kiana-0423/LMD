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
      <Field label="名称" value={molecule.name} />
      <Field label="类别" value={moleculeCategoryLabels[molecule.category] ?? molecule.category} />
      <Field label="SMILES" value={molecule.smilesRaw} full />
      <Field label="规范 SMILES" value={molecule.smilesCanonical} full />
      <Field label="InChI" value={molecule.inchi} full />
      <Field label="InChIKey" value={molecule.inchiKey} />
      <Field label="分子式" value={molecule.formula} />
      <Field label="分子量" value={molecule.molecularWeight} />
      <Field label="添加剂功能标签" value={functionTags || "-"} />
      <Field label="数据来源" value={molecule.dataSource} />
      <Field label="created from Ketcher" value={molecule.source === "ketcher" ? "是" : "否"} />
      <Field label="导入方式" value={molecule.importMode || "manual_save"} />
      <Field label="imported as new molecule" value={molecule.importMode === "new_import" || molecule.importMode === "new_copy" ? "是" : "否"} />
      <Field label="duplicate of molecule_id" value={molecule.duplicateOf || "-"} />
      <Field label="备注" value={molecule.notes} full />
    </div>
  );
}
