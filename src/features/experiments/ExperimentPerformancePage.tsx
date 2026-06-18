import { Button, Card, Form, Input, InputNumber, Select, message } from "antd";
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { listFormulations, saveExperimentWithPerformance } from "../../lib/api";
import type { Formulation } from "../../types";

export default function ExperimentPerformancePage() {
  const [form] = Form.useForm();
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listFormulations().then(setFormulations);
  }, []);

  async function saveExperiment() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const { experiment } = await saveExperimentWithPerformance(values);
      message.success(`实验已保存到配方库：${experiment.id}`);
      form.resetFields();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid experiment-page experiment-entry-only-page">
      <PageHeader title="实验与性能" description="记录测试条件、性能结果和附件路径。" />
      <Card title="实验录入">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            testType: "SRV"
          }}
        >
          <div className="experiment-form-grid">
            <Form.Item label="配方" name="formulationId" rules={[{ required: true, message: "请选择配方" }]}>
              <Select options={formulations.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item label="测试类型" name="testType" rules={[{ required: true, message: "请选择测试类型" }]}>
              <Select
                options={[
                  { value: "SRV", label: "SRV" },
                  { value: "four-ball", label: "四球试验" },
                  { value: "ball-on-disk", label: "球盘试验" },
                  { value: "PDSC", label: "PDSC" },
                  { value: "viscosity", label: "黏度测试" },
                  { value: "corrosion", label: "腐蚀测试" },
                  { value: "stability", label: "稳定性测试" },
                  { value: "other", label: "其他" }
                ]}
              />
            </Form.Item>
            <Form.Item label="测试标准" name="testStandard"><Input /></Form.Item>
            <Form.Item label="仪器" name="instrument"><Input /></Form.Item>
            <Form.Item label="上试样材料" name="upperMaterial"><Input /></Form.Item>
            <Form.Item label="下试样材料" name="lowerMaterial"><Input /></Form.Item>
            <Form.Item label="载荷" name="loadValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="温度" name="temperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="时长" name="durationValue"><InputNumber addonAfter="min" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="平均摩擦系数" name="averageFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="稳定摩擦系数" name="stableFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="磨斑直径" name="wearScarDiameterValue"><InputNumber addonAfter="um" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="初始氧化温度" name="initialOxidationTemperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="极压值" name="extremePressureValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="操作">
              <Button type="primary" block loading={saving} onClick={saveExperiment}>
                保存实验与性能
              </Button>
            </Form.Item>
          </div>
        </Form>
      </Card>
    </div>
  );
}
