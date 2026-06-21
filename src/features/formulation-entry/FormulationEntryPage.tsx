import { Button, Card, Form, Input, InputNumber, Select, Space, message } from "antd";
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { createFormulation, listAdditives, listBaseOils } from "../../lib/api";
import { additiveFunctionLabels, commonOptionLabels } from "../../lib/constants";
import type { Additive, BaseOil } from "../../types";

type AdditiveFormRow = {
  additiveId?: string;
  concentrationValue?: number;
  concentrationUnit?: string;
  notes?: string;
};

type FormulationFormValues = {
  name: string;
  baseOilId: string;
  baseOilConcentration: number;
  baseOilConcentrationUnit: string;
  additives?: AdditiveFormRow[];
  preparationMethod?: string;
  preparationTemperature?: number;
  preparationTime?: number;
  stabilityObservation?: string;
  notes?: string;
};

export default function FormulationEntryPage() {
  const [form] = Form.useForm<FormulationFormValues>();
  const [baseOils, setBaseOils] = useState<BaseOil[]>([]);
  const [additives, setAdditives] = useState<Additive[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refreshOptions();
  }, []);

  async function refreshOptions() {
    const [nextBaseOils, nextAdditives] = await Promise.all([listBaseOils(), listAdditives()]);
    setBaseOils(nextBaseOils);
    setAdditives(nextAdditives);
  }

  async function saveFormulation() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const additiveComponents = (values.additives ?? [])
        .filter((item) => item.additiveId)
        .map((item) => ({
          componentRole: "additive" as const,
          additiveId: item.additiveId,
          concentrationValue: item.concentrationValue,
          concentrationUnit: item.concentrationUnit ?? "wt%",
          notes: item.notes
        }));
      const formulation = await createFormulation({
        name: values.name,
        preparationMethod: values.preparationMethod,
        preparationTemperature: values.preparationTemperature,
        preparationTemperatureUnit: "C",
        preparationTime: values.preparationTime,
        preparationTimeUnit: "min",
        stabilityObservation: values.stabilityObservation,
        notes: values.notes,
        components: [
          {
            componentRole: "base_oil",
            baseOilId: values.baseOilId,
            concentrationValue: values.baseOilConcentration,
            concentrationUnit: values.baseOilConcentrationUnit ?? "wt%"
          },
          ...additiveComponents
        ]
      });
      message.success(`配方已保存：${formulation.name}`);
      form.resetFields();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "配方保存失败。";
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  const baseOilOptions = baseOils.map((item) => ({
    value: item.id,
    label: `${item.name}${item.baseOilType ? ` · ${item.baseOilType}` : ""}`
  }));
  const additiveOptions = additives.map((item) => ({
    value: item.id,
    label: `${item.moleculeName}${item.functionTypes.length ? ` · ${item.functionTypes.map((value) => additiveFunctionLabels[value] ?? value).join("/")}` : ""}`
  }));
  const unitOptions = ["wt%", "mol%", "ppm", "mg/mL", "volume%", "mass fraction"].map((value) => ({
    value,
    label: commonOptionLabels[value] ?? value
  }));

  return (
    <div className="page-grid entry-page formulation-entry-page">
      <PageHeader title="配方录入" description="选择基础油和多个添加剂，定义各组分比例并保存为配方。" />
      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            baseOilConcentration: 99,
            baseOilConcentrationUnit: "wt%",
            additives: [{ concentrationValue: 1, concentrationUnit: "wt%" }],
            preparationMethod: "stirring"
          }}
        >
          <div className="two-column-grid">
            <div className="form-section">
              <Form.Item label="配方名称" name="name" rules={[{ required: true, message: "请输入配方名称。" }]}>
                <Input placeholder="例如：PAO-6 + ZDDP 1.0%" />
              </Form.Item>
              <Form.Item label="基础油" name="baseOilId" rules={[{ required: true, message: "请选择基础油。" }]}>
                <Select showSearch options={baseOilOptions} optionFilterProp="label" placeholder="选择基础油" />
              </Form.Item>
              <Space size={12} wrap>
                <Form.Item
                  label="基础油比例"
                  name="baseOilConcentration"
                  rules={[{ required: true, message: "请输入基础油比例。" }]}
                >
                  <InputNumber min={0} precision={4} />
                </Form.Item>
                <Form.Item label="单位" name="baseOilConcentrationUnit">
                  <Select options={unitOptions} style={{ width: 140 }} />
                </Form.Item>
              </Space>
              <Form.Item label="制备方法" name="preparationMethod">
                <Select
                  options={["stirring", "ultrasonication", "heating", "other"].map((value) => ({
                    value,
                    label: commonOptionLabels[value] ?? value
                  }))}
                />
              </Form.Item>
              <Space size={12} wrap>
                <Form.Item label="制备温度" name="preparationTemperature">
                  <InputNumber addonAfter="C" style={{ width: 160 }} />
                </Form.Item>
                <Form.Item label="制备时间" name="preparationTime">
                  <InputNumber addonAfter="min" style={{ width: 160 }} />
                </Form.Item>
              </Space>
              <Form.Item label="稳定性观察" name="stabilityObservation">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item label="备注" name="notes">
                <Input.TextArea rows={3} />
              </Form.Item>
            </div>
            <div className="form-section">
              <Form.List name="additives">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field, index) => (
                      <div key={field.key} className="form-section">
                        <Space className="modal-action-row">
                          <strong>{`添加剂 ${index + 1}`}</strong>
                          <Button size="small" danger onClick={() => remove(field.name)}>
                            删除
                          </Button>
                        </Space>
                        <Form.Item
                          label="添加剂"
                          name={[field.name, "additiveId"]}
                          rules={[{ required: true, message: "请选择添加剂。" }]}
                        >
                          <Select showSearch options={additiveOptions} optionFilterProp="label" placeholder="选择添加剂" />
                        </Form.Item>
                        <Space size={12} wrap>
                          <Form.Item
                            label="比例"
                            name={[field.name, "concentrationValue"]}
                            rules={[{ required: true, message: "请输入添加剂比例。" }]}
                          >
                            <InputNumber min={0} precision={4} />
                          </Form.Item>
                          <Form.Item label="单位" name={[field.name, "concentrationUnit"]}>
                            <Select options={unitOptions} style={{ width: 140 }} />
                          </Form.Item>
                        </Space>
                        <Form.Item label="说明" name={[field.name, "notes"]}>
                          <Input />
                        </Form.Item>
                      </div>
                    ))}
                    <Space className="modal-action-row">
                      <Button onClick={() => add({ concentrationUnit: "wt%" })}>添加添加剂</Button>
                      <Button type="primary" loading={saving} onClick={saveFormulation}>
                        保存配方
                      </Button>
                    </Space>
                  </>
                )}
              </Form.List>
            </div>
          </div>
        </Form>
      </Card>
    </div>
  );
}
