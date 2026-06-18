import { Card, Form, Input, Select } from "antd";
import { moleculeEntryCategoryOptions, moleculeEntryFunctionOptions } from "./moleculeEntry.schema";

export default function SmilesInputCard({ category }: { category?: string }) {
  return (
    <Card title="分子身份信息">
      <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称。" }]}>
        <Input placeholder="乙醇" />
      </Form.Item>
      <Form.Item name="aliases" label="别名">
        <Input placeholder="多个别名请用逗号分隔" />
      </Form.Item>
      <Form.Item name="smiles" label="SMILES" rules={[{ required: true, message: "请输入 SMILES。" }]}>
        <Input className="mono" placeholder="CCO" />
      </Form.Item>
      <Form.Item name="category" label="类别" rules={[{ required: true }]}>
        <Select options={moleculeEntryCategoryOptions} />
      </Form.Item>
      {category === "additive" && (
        <Form.Item name="additiveFunctionTags" label="功能标签">
          <Select mode="multiple" options={moleculeEntryFunctionOptions} />
        </Form.Item>
      )}
      <Form.Item name="dataSource" label="数据来源">
        <Input placeholder="手工录入" />
      </Form.Item>
      <Form.Item name="notes" label="备注">
        <Input.TextArea rows={3} />
      </Form.Item>
    </Card>
  );
}
