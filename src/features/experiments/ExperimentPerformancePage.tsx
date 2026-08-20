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
      message.success(`Experiment saved to the formulation library: ${experiment.id}`);
      form.resetFields();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid experiment-page experiment-entry-only-page">
      <PageHeader title="Experiments & Performance" description="Record test conditions, performance results, and attachment paths." />
      <Card title="Experiment Entry">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            durationUnit: "min",
            loadUnit: "N",
            repeatCount: 3,
            temperatureUnit: "C",
            testType: "SRV"
          }}
        >
          <div className="experiment-form-grid">
            <Form.Item label="Formulation" name="formulationId" rules={[{ required: true, message: "Select a formulation" }]}>
              <Select options={formulations.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item label="Test Type" name="testType" rules={[{ required: true, message: "Select a test type" }]}>
              <Select
                options={[
                  { value: "SRV", label: "SRV" },
                  { value: "four-ball", label: "Four-ball Test" },
                  { value: "ball-on-disk", label: "Ball-on-disk Test" },
                  { value: "PDSC", label: "PDSC" },
                  { value: "viscosity", label: "Viscosity Test" },
                  { value: "corrosion", label: "Corrosion Test" },
                  { value: "stability", label: "Stability Test" },
                  { value: "other", label: "Other" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Test Standard" name="testStandard"><Input /></Form.Item>
            <Form.Item label="Instrument" name="instrument"><Input /></Form.Item>
            <Form.Item label="Upper Specimen Material" name="upperMaterial"><Input /></Form.Item>
            <Form.Item label="Lower Specimen Material" name="lowerMaterial"><Input /></Form.Item>
            <Form.Item label="Experiment Date" name="experimentDate"><Input type="date" /></Form.Item>
            <Form.Item label="Operator" name="operator"><Input /></Form.Item>
            <Form.Item label="Load" name="loadValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Temperature" name="temperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Duration" name="durationValue"><InputNumber addonAfter="min" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Average Friction Coefficient" name="averageFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Stable Friction Coefficient" name="stableFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Wear Scar Diameter" name="wearScarDiameterValue"><InputNumber addonAfter="um" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Initial Oxidation Temperature" name="initialOxidationTemperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Extreme-pressure Value" name="extremePressureValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Repeat Count" name="repeatCount"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Notes" name="notes"><Input /></Form.Item>
            <Form.Item label="Actions">
              <Button type="primary" block loading={saving} onClick={saveExperiment}>
                Save Experiment and Performance
              </Button>
            </Form.Item>
          </div>
        </Form>
      </Card>
    </div>
  );
}
