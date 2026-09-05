import { Card, Form, Input, Select } from "antd";
import type { ReactNode } from "react";
import { moleculeEntryCategoryOptions, moleculeEntryFunctionOptions } from "./moleculeEntry.schema";
import { useLanguage } from "../../i18n/LanguageContext";

export default function SmilesInputCard({ category, importControl }: { category?: string; importControl?: ReactNode }) {
  const { t } = useLanguage();
  return (
    <Card title={t("ui.moleculeIdentity")} className="molecule-entry-identity" size="small">
      {importControl}
      <div className="molecule-entry-fields">
      <Form.Item name="name" label={t("ui.name")} rules={[{ required: true, message: t("ui.enterAName") }]}>
        {/* i18n-exempt: an example molecule name reads the same in every language. */}
        <Input placeholder="Ethanol" />
      </Form.Item>
      <Form.Item name="aliases" label={t("ui.aliases")}>
        <Input placeholder={t("ui.separateMultipleAliasesWithCommas")} />
      </Form.Item>
      <Form.Item className="molecule-entry-wide" name="smiles" label="SMILES" rules={[{ required: true, message: t("ui.enterASmilesString") }]}>
        <Input className="mono" placeholder="CCO" />
      </Form.Item>
      <Form.Item name="category" label={t("ui.category")} rules={[{ required: true }]}>
        <Select options={moleculeEntryCategoryOptions.map((item) => ({ value: item.value, label: t(item.key) }))} />
      </Form.Item>
      {category === "additive" && (
        <Form.Item name="additiveFunctionTags" label={t("ui.functionTags")}>
          <Select
            mode="multiple"
            maxTagCount="responsive"
            options={moleculeEntryFunctionOptions.map((item) => ({ value: item.value, label: t(item.key) }))}
          />
        </Form.Item>
      )}
      <Form.Item name="dataSource" label={t("ui.dataSource")}>
        <Input placeholder={t("ui.manualEntry")} />
      </Form.Item>
      <Form.Item className="molecule-entry-wide" name="notes" label={t("ui.notes")}>
        <Input.TextArea rows={2} />
      </Form.Item>
      </div>
    </Card>
  );
}
