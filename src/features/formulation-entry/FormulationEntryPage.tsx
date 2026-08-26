import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, message } from "antd";

import PageHeader from "../../components/PageHeader";
import AsyncBoundary from "../../components/AsyncBoundary";
import { createFormulation, searchAdditives, searchBaseOils } from "../../lib/api";
import { commonOptionLabelKeys } from "../../lib/constants";
import type { EntityOption } from "../../types";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";

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

/**
 * The same rule the backend enforces, so a blend is refused here rather than after a round trip.
 *
 * Zero is refused deliberately: a component present at zero concentration is not a component, and
 * storing it makes a blend look like it contains something it does not.
 */
function positiveConcentration(message: string) {
  return () => ({
    validator(_: unknown, value: unknown) {
      if (value === undefined || value === null || value === "") return Promise.resolve();
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Promise.resolve()
        : Promise.reject(new Error(message));
    }
  });
}

export default function FormulationEntryPage() {
  const { t } = useLanguage();
  const [form] = Form.useForm<FormulationFormValues>();

  // Selector-sized reads: id, label, and a short qualifier. The whole base-oil and additive tables
  // used to be downloaded to fill two dropdowns.
  const options = useAsyncResource(
    () => Promise.all([searchBaseOils("", 50), searchAdditives("", 50)]),
    []
  );
  const [baseOilOptionRows, additiveOptionRows] = options.data ?? [[], []];

  const save = useAsyncAction(async () => {
    const values = await form.validateFields();
    {
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
      message.success(`${t("ui.formulationSaved")} ${formulation.name}`);
      form.resetFields();
    }
  }, {
    onError: (error) => {
      // Field-level validation is already shown against the field it belongs to.
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(`${t("ui.failedToSaveTheFormulation")} ${backendErrorText(error, t)}`.trim());
    }
  });

  const toOption = (item: EntityOption) => ({
    value: item.id,
    // A record's own name and classification: the user's data, not interface text.
    label: `${item.label}${item.detail ? ` · ${item.detail}` : ""}`
  });
  const baseOilOptions = baseOilOptionRows.map(toOption);
  const additiveOptions = additiveOptionRows.map(toOption);
  const unitOptions = ["wt%", "mol%", "ppm", "mg/mL", "volume%", "mass fraction"].map((value) => ({
    value,
    label: commonOptionLabelKeys[value] ? t(commonOptionLabelKeys[value]) : value
  }));

  return (
    <div className="page-grid entry-page formulation-entry-page">
      <PageHeader title={t("ui.formulationEntry")} description={t("ui.selectABaseOilAndAdditivesDefineComponent")} />
      <Card>
        <Alert type="info" showIcon message={t("entry.noAssumedValues")} style={{ marginBottom: 16 }} />
        <AsyncBoundary loading={options.loading} error={options.error} onRetry={options.reload} rows={3}>
        <Form
          form={form}
          layout="vertical"
          // Only units, never values. `99 wt%` base oil, `1 wt%` additive and `stirring` used to
          // be filled in when the form opened: three claims about a blend nobody had made yet,
          // and three numbers that would have been stored verbatim if the user had not noticed
          // them. A unit is a label on a number the user is about to type; a value is not.
          initialValues={{
            baseOilConcentrationUnit: "wt%",
            additives: [{ concentrationUnit: "wt%" }]
          }}
        >
          <div className="two-column-grid">
            <div className="form-section">
              <Form.Item label={t("ui.formulationName")} name="name" rules={[{ required: true, message: t("ui.enterAFormulationName") }]}>
                <Input placeholder={t("ui.examplePao6Zddp10")} />
              </Form.Item>
              <Form.Item label={t("ui.baseOil")} name="baseOilId" rules={[{ required: true, message: t("ui.selectABaseOil2") }]}>
                <Select showSearch options={baseOilOptions} optionFilterProp="label" placeholder={t("ui.selectABaseOil")} />
              </Form.Item>
              <Space size={12} wrap>
                <Form.Item
                  label={t("ui.baseOilRatio")}
                  name="baseOilConcentration"
                  rules={[
                    { required: true, message: t("ui.enterTheBaseOilRatio") },
                    positiveConcentration(t("entry.concentrationRequired"))
                  ]}
                >
                  <InputNumber precision={4} />
                </Form.Item>
                <Form.Item label={t("ui.unit")} name="baseOilConcentrationUnit">
                  <Select options={unitOptions} style={{ width: 140 }} />
                </Form.Item>
              </Space>
              <Form.Item label={t("ui.preparationMethod")} name="preparationMethod">
                <Select
                  allowClear
                  placeholder={t("entry.selectPreparationMethod")}
                  options={["stirring", "ultrasonication", "heating", "other"].map((value) => ({
                    value,
                    label: commonOptionLabelKeys[value] ? t(commonOptionLabelKeys[value]) : value
                  }))}
                />
              </Form.Item>
              <Space size={12} wrap>
                <Form.Item label={t("ui.preparationTemperature")} name="preparationTemperature">
                  <InputNumber addonAfter="C" style={{ width: 160 }} />
                </Form.Item>
                <Form.Item label={t("ui.preparationTime")} name="preparationTime">
                  <InputNumber addonAfter="min" style={{ width: 160 }} />
                </Form.Item>
              </Space>
              <Form.Item label={t("ui.stabilityObservation")} name="stabilityObservation">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item label={t("ui.notes")} name="notes">
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
                          <strong>{`${t("ui.additiveNumber")} ${index + 1}`}</strong>
                          <Button size="small" danger onClick={() => remove(field.name)}>{t("ui.delete")}</Button>
                        </Space>
                        <Form.Item
                          label={t("ui.additive")}
                          name={[field.name, "additiveId"]}
                          rules={[{ required: true, message: t("ui.selectAnAdditive2") }]}
                        >
                          <Select showSearch options={additiveOptions} optionFilterProp="label" placeholder={t("ui.selectAnAdditive")} />
                        </Form.Item>
                        <Space size={12} wrap>
                          <Form.Item
                            label={t("ui.ratio")}
                            name={[field.name, "concentrationValue"]}
                            rules={[
                              { required: true, message: t("ui.enterTheAdditiveRatio") },
                              positiveConcentration(t("entry.concentrationRequired"))
                            ]}
                          >
                            <InputNumber precision={4} />
                          </Form.Item>
                          <Form.Item label={t("ui.unit")} name={[field.name, "concentrationUnit"]}>
                            <Select options={unitOptions} style={{ width: 140 }} />
                          </Form.Item>
                        </Space>
                        <Form.Item label={t("ui.description")} name={[field.name, "notes"]}>
                          <Input />
                        </Form.Item>
                      </div>
                    ))}
                    <Space className="modal-action-row">
                      <Button onClick={() => add({ concentrationUnit: "wt%" })}>{t("ui.addAdditive")}</Button>
                      <Button type="primary" loading={save.running} onClick={() => void save.run()}>{t("ui.saveFormulation")}</Button>
                    </Space>
                  </>
                )}
              </Form.List>
            </div>
          </div>
        </Form>
        </AsyncBoundary>
      </Card>
    </div>
  );
}
