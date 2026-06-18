import { Button, Card, Form, Input, InputNumber, Select, Space, Table, message } from "antd";
import { useState } from "react";
import PageHeader from "../../components/PageHeader";
import { commonOptionLabels } from "../../lib/constants";

type ComponentRow = {
  key: string;
  componentRole: string;
  concentrationUnit: string;
};

export default function FormulationEntryPage() {
  const [components, setComponents] = useState<ComponentRow[]>([
    { key: "component-1", componentRole: "base_oil", concentrationUnit: "wt%" }
  ]);

  return (
    <div className="page-grid entry-page formulation-entry-page">
      <PageHeader title="配方录入" description="按组分录入配方，包含浓度单位和制备元数据。" />
      <Card>
        <Form layout="vertical">
          <div className="two-column-grid">
            <div className="form-section">
              <Form.Item label="配方名称" required>
                <Input placeholder="PAO-6 + 添加剂包" />
              </Form.Item>
              <Form.Item label="制备方法">
                <Select options={["stirring", "ultrasonication", "heating", "other"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} />
              </Form.Item>
              <Form.Item label="制备温度">
                <InputNumber addonAfter="C" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="制备时间">
                <InputNumber addonAfter="min" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="稳定性观察">
                <Input.TextArea rows={3} />
              </Form.Item>
            </div>
            <div className="form-section">
              <Table
                rowKey="key"
                pagination={false}
                dataSource={components}
                columns={[
                  {
                    title: "角色",
                    dataIndex: "componentRole",
                    render: (_, row) => (
                      <Select
                        defaultValue={row.componentRole}
                        options={["base_oil", "additive", "solvent", "other"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))}
                      />
                    )
                  },
                  { title: "分子/基础油/添加剂", render: () => <Select style={{ width: 180 }} placeholder="选择记录" /> },
                  { title: "浓度", render: () => <InputNumber min={0} style={{ width: 120 }} /> },
                  {
                    title: "单位",
                    render: (_, row) => (
                      <Select
                        defaultValue={row.concentrationUnit}
                        style={{ width: 120 }}
                        options={["wt%", "mol%", "ppm", "mg/mL", "volume%", "mass fraction"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))}
                      />
                    )
                  },
                  {
                    title: "操作",
                    render: (_, row) => (
                      <Button danger size="small" onClick={() => setComponents((items) => items.filter((item) => item.key !== row.key))}>
                        删除
                      </Button>
                    )
                  }
                ]}
              />
              <Space style={{ marginTop: 12 }}>
                <Button onClick={() => setComponents((items) => [...items, { key: `component-${Date.now()}`, componentRole: "additive", concentrationUnit: "wt%" }])}>
                  添加组分
                </Button>
                <Button type="primary" onClick={() => message.success("模拟配方已保存。下一阶段将跳转到配方库。")}>
                  保存配方
                </Button>
              </Space>
            </div>
          </div>
        </Form>
      </Card>
    </div>
  );
}
