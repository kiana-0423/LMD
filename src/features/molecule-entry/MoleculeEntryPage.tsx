import { Alert, Button, Card, Form, Input, Progress, Steps, Tooltip, Typography, message } from "antd";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import MoleculeStructurePreview from "../../components/MoleculeStructurePreview";
import { mol2ToSmiles, saveMoleculeWithRequiredDescriptors } from "../../lib/api";
import type { Molecule } from "../../types";
import SmilesInputCard from "./SmilesInputCard";
import { saveStepKeys } from "./moleculeEntry.schema";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";

export default function MoleculeEntryPage() {
  const { t } = useLanguage();
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const category = Form.useWatch("category", form);
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Molecule>();
  const fileInput = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [importReview, setImportReview] = useState<{ filename: string; count: number; atomCount: number }>();

  async function importMol2(file: File) {
    if (importingRef.current || saving) return;
    setImportError(undefined);
    if (!/\.mol2$/i.test(file.name)) {
      setImportError(t("moleculeEntry.mol2Only"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportError(t("moleculeEntry.mol2TooLarge"));
      return;
    }
    if (!file.size) {
      setImportError(t("moleculeEntry.mol2Empty"));
      return;
    }
    importingRef.current = true;
    setImporting(true);
    try {
      const { smiles, inferredBondIds, normalizedAtomTypes = [] } = await mol2ToSmiles(await file.text());
      const name = form.getFieldValue("name")?.trim() ? form.getFieldValue("name") : file.name.replace(/\.mol2$/i, "");
      const source = form.getFieldValue("dataSource");
      const previousNotes = form.getFieldValue("notes") ?? "";
      // i18n-exempt: record the import interpretation as provenance, with original bond IDs.
      const inferenceNote = `MOL2 import (${file.name}): inferred aromatic bond IDs: ${inferredBondIds.join(", ") || "none"}; atom type changes: ${normalizedAtomTypes.join(", ") || "none"}.`;
      form.setFieldsValue({
        smiles,
        name,
        notes: (inferredBondIds.length || normalizedAtomTypes.length) && !previousNotes.includes(inferenceNote)
          ? [previousNotes, inferenceNote].filter(Boolean).join("\n") : previousNotes,
        // i18n-exempt: provenance is stored data, not a translated interface label.
        dataSource: !source?.trim() || source === "Manual entry" ? `MOL2 import: ${file.name}` : source
      });
      setImportReview(inferredBondIds.length || normalizedAtomTypes.length
        ? { filename: file.name, count: inferredBondIds.length, atomCount: normalizedAtomTypes.length } : undefined);
      setSaved(undefined);
      message.success(t("moleculeEntry.mol2Imported"));
    } catch (error) {
      setImportError(backendErrorText(error, t));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  async function runSave() {
    if (importingRef.current || saving) return;
    const values = await form.validateFields();
    setSaving(true);
    setSaved(undefined);
    try {
      for (let index = 0; index < saveStepKeys.length; index += 1) {
        setCurrent(index);
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      const molecule = await saveMoleculeWithRequiredDescriptors({
        ...values,
        additiveFunctionTags: values.additiveFunctionTags ?? []
      });
      form.resetFields();
      setImportError(undefined);
      setImportReview(undefined);
      if (fileInput.current) fileInput.current.value = "";
      setSaved(molecule);
      message.success(t("ui.moleculeSavedWithRdkitAndMordredDescriptorRe"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid entry-page molecule-entry-page">
      <PageHeader
        title={t("ui.moleculeEntry")}
        description={t("ui.saveMoleculesAndGenerateRealRdkitAndMordred")}
      />
      <Form
        form={form}
        layout="vertical"
        size="small"
        className="molecule-entry-form"
        disabled={saving || importing}
        onValuesChange={() => setSaved(undefined)}
        initialValues={{
          // `candidate` is the "not yet classified" category, which is what an unfilled form
          // genuinely means. `antiwear` used to be pre-selected here, which asserted a function
          // for a molecule nobody had tested — so it is gone.
          category: "candidate",
          // i18n-exempt: stored as the record's data source, so it stays as written.
          dataSource: "Manual entry",
          additiveFunctionTags: []
        }}
      >
        <div className="molecule-entry-columns">
          <SmilesInputCard category={category} importControl={
            <div className="molecule-entry-import">
              <div className="molecule-entry-import-line">
              <input ref={fileInput} type="file" accept=".mol2" hidden aria-label={t("moleculeEntry.importMol2")}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importMol2(file);
                }} />
              <Button loading={importing} onClick={() => fileInput.current?.click()}>{t("moleculeEntry.importMol2")}</Button>
              <Typography.Text type="secondary" ellipsis={{ tooltip: t("moleculeEntry.mol2Help") }}>{t("moleculeEntry.mol2Help")}</Typography.Text>
              </div>
              {importError && <Tooltip title={importError} trigger={["hover", "focus"]}><div tabIndex={0}><Alert type="error" showIcon message={importError} /></div></Tooltip>}
              {importReview && <Tooltip title={t("moleculeEntry.mol2InferredBonds", importReview)} trigger={["hover", "focus"]}><div tabIndex={0}><Alert type="warning" showIcon message={t("moleculeEntry.mol2InferredBonds", importReview)} /></div></Tooltip>}
            </div>
          } />
          <Card title={t(saved ? "ui.generatedMoleculeMetadata" : "ui.calculationProgress")} className="molecule-entry-output" size="small">
            {saved ? (
              <div className="molecule-entry-result">
                <MoleculeStructurePreview svg={saved.structureSvg} title={t("ui.generated2dStructure")} />
                <div className="molecule-entry-metadata">
                  <label className="molecule-entry-wide">
                    {t("ui.canonicalSmilesLabel")}
                    <Input readOnly className="mono" value={saved.smilesCanonical} title={saved.smilesCanonical} translate="no" />
                  </label>
                  <label className="molecule-entry-wide">
                    {t("ui.inchiKeyLabel")}
                    <Input readOnly className="mono" value={saved.inchiKey} title={saved.inchiKey} translate="no" />
                  </label>
                  <div>{t("ui.molecularFormulaLabel")}: <span translate="no">{saved.formula}</span></div>
                  <div>{t("ui.molecularWeightLabel")}: <span translate="no">{saved.molecularWeight}</span></div>
                </div>
              </div>
            ) : <Steps
              direction="vertical"
              size="small"
              className="molecule-entry-steps"
              current={saving ? current : 0}
              items={saveStepKeys.map((key) => ({ title: t(key) }))}
            />}
            <div className="molecule-entry-save">
            <Progress className="entry-progress" percent={saved ? 100 : saving ? Math.round(((current + 1) / saveStepKeys.length) * 100) : 0} />
            <div className="molecule-entry-save-actions">
              <Button type="primary" loading={saving} onClick={runSave}>{t("ui.saveMoleculeAndCalculateDescriptors")}</Button>
              <Button disabled={!saved} onClick={() => navigate("/molecules")}>{t("ui.viewInMoleculeLibrary")}</Button>
            </div>
            </div>
          </Card>
        </div>
      </Form>
    </div>
  );
}
