import { Button, Card, Form, Progress, Space, Steps, Typography, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import MoleculeStructurePreview from "../../components/MoleculeStructurePreview";
import { saveMoleculeWithRequiredDescriptors } from "../../lib/api";
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

  async function runSave() {
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
      setSaved(molecule);
      message.success(t("ui.moleculeSavedWithRdkitAndMordredDescriptorRe"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid entry-page">
      <PageHeader
        title={t("ui.moleculeEntry")}
        description={t("ui.saveMoleculesAndGenerateRealRdkitAndMordred")}
      />
      <Form
        form={form}
        layout="vertical"
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
        <div className="two-column-grid">
          <SmilesInputCard category={category} />
          <Card title={t("ui.calculationProgress")}>
            <Steps
              direction="vertical"
              current={saving ? current : saved ? saveStepKeys.length : 0}
              items={saveStepKeys.map((key) => ({ title: t(key) }))}
            />
            <Progress className="entry-progress" percent={saved ? 100 : saving ? Math.round(((current + 1) / saveStepKeys.length) * 100) : 0} />
            <Space wrap>
              <Button type="primary" loading={saving} onClick={runSave}>{t("ui.saveMoleculeAndCalculateDescriptors")}</Button>
              <Button disabled={!saved} onClick={() => navigate("/molecules")}>{t("ui.viewInMoleculeLibrary")}</Button>
            </Space>
          </Card>
        </div>
      </Form>
      {saved && (
        <div className="two-column-grid">
          <MoleculeStructurePreview svg={saved.structureSvg} title={t("ui.generated2dStructure")} />
          <Card title={t("ui.generatedMoleculeMetadata")}>
            <Typography.Paragraph>
              <strong>{`${t("ui.canonicalSmilesLabel")}:`}</strong>{" "}
              <span className="mono" translate="no">
                {saved.smilesCanonical}
              </span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>{`${t("ui.inchiKeyLabel")}:`}</strong>{" "}
              <span className="mono" translate="no">
                {saved.inchiKey}
              </span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>{`${t("ui.molecularFormulaLabel")}:`}</strong>{" "}
              <span translate="no">{saved.formula}</span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>{`${t("ui.molecularWeightLabel")}:`}</strong>{" "}
              <span translate="no">{saved.molecularWeight}</span>
            </Typography.Paragraph>
          </Card>
        </div>
      )}
    </div>
  );
}
