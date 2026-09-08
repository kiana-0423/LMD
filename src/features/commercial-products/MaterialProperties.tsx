import { Button, Descriptions, Form, Input, InputNumber, Space, Typography } from "antd";
import { useLanguage } from "../../i18n/LanguageContext";
import type { MaterialProperties } from "../../lib/api";

const numericFields = [
  { name: "viscosity40c", label: "product.viscosity40c", positive: true },
  { name: "viscosity100c", label: "product.viscosity100c", positive: true },
  { name: "viscosityIndex", label: "ui.viscosityIndex", positive: false },
  { name: "density", label: "product.density", positive: true },
  { name: "pourPoint", label: "product.pourPoint", positive: false },
  { name: "flashPoint", label: "product.flashPoint", positive: false }
] as const;

export function MaterialPropertiesFields() {
  const { t } = useLanguage();
  return (
    <div className="catalogue-editor-form">
      <Typography.Paragraph type="secondary" className="catalogue-editor-wide">
        {t("product.propertiesHelp")}
      </Typography.Paragraph>
      {numericFields.map(({ name, label, positive }) => (
        <Form.Item
          key={name}
          name={["materialProperties", name]}
          label={t(label)}
          rules={[
            {
              validator: (_, value: number | null | undefined) =>
                value == null || (Number.isFinite(value) && (!positive || value > 0))
                  ? Promise.resolve()
                  : Promise.reject(new Error(t("product.invalidProperties")))
            }
          ]}
        >
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
      ))}
      <Form.Item name={["materialProperties", "appearance"]} label={t("product.appearance")}>
        <Input />
      </Form.Item>
      <Form.Item name={["materialProperties", "solubility"]} label={t("product.solubility")}>
        <Input />
      </Form.Item>
      <Form.Item
        className="catalogue-editor-wide"
        name={["materialProperties", "conditions"]}
        label={t("product.propertyConditions")}
      >
        <Input />
      </Form.Item>
      <div className="catalogue-editor-wide">
        <Typography.Title level={5}>{t("product.customProperties")}</Typography.Title>
        <Form.List name={["materialProperties", "custom"]}>
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div
                  className="catalogue-editor-form"
                  key={field.key}
                  role="group"
                  aria-label={`${t("product.customProperties")} ${index + 1}`}
                >
                  <Form.Item
                    name={[field.name, "name"]}
                    label={t("product.propertyName")}
                    rules={[{ required: true, whitespace: true, message: t("product.propertyRequired") }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "value"]}
                    label={t("product.propertyValue")}
                    rules={[{ required: true, whitespace: true, message: t("product.propertyRequired") }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name={[field.name, "unit"]} label={t("ui.unit")}>
                    <Input />
                  </Form.Item>
                  <Form.Item name={[field.name, "conditions"]} label={t("product.propertyConditions")}>
                    <Input />
                  </Form.Item>
                  <Button danger className="catalogue-editor-wide" onClick={() => remove(field.name)}>
                    {t("product.removeProperty")}
                  </Button>
                </div>
              ))}
              <Button onClick={() => add({ name: "", value: "", unit: "", conditions: "" })}>
                {t("product.addProperty")}
              </Button>
            </Space>
          )}
        </Form.List>
      </div>
    </div>
  );
}

export function MaterialPropertiesDetails({ properties = {} }: { properties?: MaterialProperties }) {
  const { t } = useLanguage();
  return (
    <div style={{ width: "100%" }}>
      <Typography.Title level={5}>{t("product.materialProperties")}</Typography.Title>
      <Descriptions bordered column={2} size="small">
        {numericFields.map(({ name, label }) => (
          <Descriptions.Item key={name} label={t(label)}>
            {properties[name] ?? "—"}
          </Descriptions.Item>
        ))}
        <Descriptions.Item label={t("product.appearance")}>{properties.appearance || "—"}</Descriptions.Item>
        <Descriptions.Item label={t("product.solubility")}>{properties.solubility || "—"}</Descriptions.Item>
        <Descriptions.Item span={2} label={t("product.propertyConditions")}>
          {properties.conditions || "—"}
        </Descriptions.Item>
        {(properties.custom ?? []).map((property, index) => (
          <Descriptions.Item key={index} span={2} label={<span translate="no">{property.name}</span>}>
            <Space direction="vertical" size={0}>
              <span translate="no">
                {property.value}
                {property.unit ? ` ${property.unit}` : ""}
              </span>
              {property.conditions && (
                <Typography.Text type="secondary" translate="no">
                  {property.conditions}
                </Typography.Text>
              )}
            </Space>
          </Descriptions.Item>
        ))}
      </Descriptions>
    </div>
  );
}
