import { Card, Form, Input, Select } from "antd";
import { moleculeEntryCategoryOptions, moleculeEntryFunctionOptions } from "./moleculeEntry.schema";
import { useLanguage } from "../../i18n/LanguageContext";

export default function SmilesInputCard({ category }: { category?: string }) {
  const { t } = useLanguage();
  return (
    <Card title={t("ui.moleculeIdentity")}>
      <Form.Item name="name" label={t("ui.name")} rules={[{ required: true, message: t("ui.enterAName") }]}>
        <Input placeholder="Ethanol" /> {/* i18n-exempt: an example molecule name reads the same in every language. */}
      </Form.Item>
      <Form.Item name="aliases" label={t("ui.aliases")}>
        <Input placeholder={t("ui.separateMultipleAliasesWithCommas")} />
      </Form.Item>
      <Form.Item name="smiles" label="SMILES" rules={[{ required: true, message: t("ui.enterASmilesString") }]}>
        <Input className="mono" placeholder="CCO" />
      </Form.Item>
      <Form.Item name="category" label={t("ui.category")} rules={[{ required: true }]}>
        <Select options={moleculeEntryCategoryOptions.map((item) => ({ value: item.value, label: t(item.key) }))} />
      </Form.Item>
      {category === "additive" && (
        <Form.Item name="additiveFunctionTags" label={t("ui.functionTags")}>
          <Select
            mode="multiple"
            options={moleculeEntryFunctionOptions.map((item) => ({ value: item.value, label: t(item.key) }))}
          />
        </Form.Item>
      )}
      <Form.Item name="dataSource" label={t("ui.dataSource")}>
        <Input placeholder={t("ui.manualEntry")} />
      </Form.Item>
      <Form.Item name="notes" label={t("ui.notes")}>
        <Input.TextArea rows={3} />
      </Form.Item>
    </Card>
  );
}
