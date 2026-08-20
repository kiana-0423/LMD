import { Button, Card, Form, Modal, Progress, Space, Steps, Typography, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import MoleculeStructurePreview from "../../components/MoleculeStructurePreview";
import { saveMoleculeWithRequiredDescriptors } from "../../lib/api";
import type { Molecule } from "../../types";
import SmilesInputCard from "./SmilesInputCard";
import { saveSteps } from "./moleculeEntry.schema";

export default function MoleculeEntryPage() {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const category = Form.useWatch("category", form);
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Molecule>();

  async function runSave(allowMock: boolean) {
    const values = await form.validateFields();
    setSaving(true);
    setSaved(undefined);
    try {
      for (let index = 0; index < saveSteps.length; index += 1) {
        setCurrent(index);
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      const molecule = await saveMoleculeWithRequiredDescriptors({
        ...values,
        allowMock,
        additiveFunctionTags: values.additiveFunctionTags ?? []
      });
      setSaved(molecule);
      message.success("Molecule saved with RDKit and Mordred descriptor records.");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function saveWithConfirmation() {
    Modal.confirm({
      title: "Save with mock Mordred descriptors?",
      content:
        "Development mode can save mock Mordred descriptors, but records must be marked descriptor_status = mock and mode = mock.",
      onOk: () => runSave(true)
    });
  }

  return (
    <div className="page-grid entry-page">
      <PageHeader
        title="Molecule Entry"
        description="Save molecules and generate RDKit and Mordred descriptor records. The MVP may use clearly marked mock descriptors."
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          category: "candidate",
          dataSource: "Manual entry",
          additiveFunctionTags: ["antiwear"]
        }}
      >
        <div className="two-column-grid">
          <SmilesInputCard category={category} />
          <Card title="Calculation Progress">
            <Steps
              direction="vertical"
              current={saving ? current : saved ? saveSteps.length : 0}
              items={saveSteps.map((title) => ({ title }))}
            />
            <Progress className="entry-progress" percent={saved ? 100 : saving ? Math.round(((current + 1) / saveSteps.length) * 100) : 0} />
            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => runSave(false)}>
                Save Molecule and Calculate Descriptors
              </Button>
              <Button loading={saving} onClick={saveWithConfirmation}>
                Save with Mock Descriptors
              </Button>
              <Button disabled={!saved} onClick={() => navigate("/molecules")}>
                View in Molecule Library
              </Button>
            </Space>
          </Card>
        </div>
      </Form>
      {saved && (
        <div className="two-column-grid">
          <MoleculeStructurePreview svg={saved.structureSvg} title="Generated 2D Structure" />
          <Card title="Generated Molecule Metadata">
            <Typography.Paragraph>
              <strong>Canonical SMILES:</strong> <span className="mono">{saved.smilesCanonical}</span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>InChIKey：</strong> <span className="mono">{saved.inchiKey}</span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>Molecular Formula:</strong> {saved.formula}
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>Molecular Weight:</strong> {saved.molecularWeight}
            </Typography.Paragraph>
          </Card>
        </div>
      )}
    </div>
  );
}
