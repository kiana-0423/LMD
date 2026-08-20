import { Card, Form, Input, Select } from "antd";
import { moleculeEntryCategoryOptions, moleculeEntryFunctionOptions } from "./moleculeEntry.schema";

export default function SmilesInputCard({ category }: { category?: string }) {
  return (
    <Card title="Molecule Identity">
      <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name." }]}>
        <Input placeholder="Ethanol" />
      </Form.Item>
      <Form.Item name="aliases" label="Aliases">
        <Input placeholder="Separate multiple aliases with commas" />
      </Form.Item>
      <Form.Item name="smiles" label="SMILES" rules={[{ required: true, message: "Enter a SMILES string." }]}>
        <Input className="mono" placeholder="CCO" />
      </Form.Item>
      <Form.Item name="category" label="Category" rules={[{ required: true }]}>
        <Select options={moleculeEntryCategoryOptions} />
      </Form.Item>
      {category === "additive" && (
        <Form.Item name="additiveFunctionTags" label="Function Tags">
          <Select mode="multiple" options={moleculeEntryFunctionOptions} />
        </Form.Item>
      )}
      <Form.Item name="dataSource" label="Data Source">
        <Input placeholder="Manual entry" />
      </Form.Item>
      <Form.Item name="notes" label="Notes">
        <Input.TextArea rows={3} />
      </Form.Item>
    </Card>
  );
}
