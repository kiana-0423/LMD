import { Alert, Button, Card, Form, Modal, Progress, Space, Steps, Typography, message } from "antd";
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
      message.success("分子已保存，并已写入 RDKit + Mordred 描述符记录。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function saveWithConfirmation() {
    Modal.confirm({
      title: "是否使用模拟 Mordred 描述符保存？",
      content:
        "开发模式可以保存模拟 Mordred 描述符，但记录必须明确标记为 descriptor_status = mock 且 mode = mock。",
      onOk: () => runSave(true)
    });
  }

  return (
    <div className="page-grid entry-page">
      <PageHeader
        title="分子录入"
        description="保存分子时会强制走 RDKit 与 Mordred 描述符流程；第一阶段 MVP 可使用明确标记的模拟描述符。"
      />
      <Alert
        type="warning"
        showIcon
        message="Mordred 描述符为强制功能"
        description="正式模式不得跳过 Mordred；开发模拟模式仅在记录明确标记为 mock 时允许。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          category: "candidate",
          dataSource: "手工录入",
          additiveFunctionTags: ["antiwear"]
        }}
      >
        <div className="two-column-grid">
          <SmilesInputCard category={category} />
          <Card title="计算进度">
            <Steps
              direction="vertical"
              current={saving ? current : saved ? saveSteps.length : 0}
              items={saveSteps.map((title) => ({ title }))}
            />
            <Progress className="entry-progress" percent={saved ? 100 : saving ? Math.round(((current + 1) / saveSteps.length) * 100) : 0} />
            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => runSave(false)}>
                保存分子并计算描述符
              </Button>
              <Button loading={saving} onClick={saveWithConfirmation}>
                使用模拟描述符保存
              </Button>
              <Button disabled={!saved} onClick={() => navigate("/molecules")}>
                在分子库中查看
              </Button>
            </Space>
          </Card>
        </div>
      </Form>
      {saved && (
        <div className="two-column-grid">
          <MoleculeStructurePreview svg={saved.structureSvg} title="生成的 2D 结构" />
          <Card title="生成的分子元数据">
            <Typography.Paragraph>
              <strong>规范 SMILES：</strong> <span className="mono">{saved.smilesCanonical}</span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>InChIKey：</strong> <span className="mono">{saved.inchiKey}</span>
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>分子式：</strong> {saved.formula}
            </Typography.Paragraph>
            <Typography.Paragraph>
              <strong>分子量：</strong> {saved.molecularWeight}
            </Typography.Paragraph>
          </Card>
        </div>
      )}
    </div>
  );
}
