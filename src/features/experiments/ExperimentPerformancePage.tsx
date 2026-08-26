import { Alert, Button, Card, Form, Input, InputNumber, Select, Typography, message } from "antd";
import PageHeader from "../../components/PageHeader";
import AsyncBoundary from "../../components/AsyncBoundary";
import { saveExperimentWithPerformance, searchFormulations } from "../../lib/api";
import type { ExperimentPerformancePayload } from "../../lib/api";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";

/**
 * The test methods LMD knows how to interpret.
 *
 * There is no default. `SRV` used to be selected when the form opened, so a form filled in by
 * somebody running a four-ball test and not looking at the first field recorded the wrong method —
 * and nothing downstream could tell, because a recorded method is indistinguishable from a chosen
 * one.
 */
const TEST_TYPES = [
  { value: "SRV", labelKey: undefined },
  { value: "four-ball", labelKey: "ui.fourBallTest" },
  { value: "ball-on-disk", labelKey: "ui.ballOnDiskTest" },
  { value: "PDSC", labelKey: undefined },
  { value: "viscosity", labelKey: "ui.viscosityTest" },
  { value: "corrosion", labelKey: "ui.corrosionTest" },
  { value: "stability", labelKey: "ui.stabilityTest" },
  { value: "other", labelKey: "ui.other" }
] as const;

export default function ExperimentPerformancePage() {
  const { t } = useLanguage();
  const [form] = Form.useForm<ExperimentPerformancePayload>();

  // A search endpoint rather than the whole table: a workspace with a thousand blends should not
  // download all of them to populate one dropdown.
  const formulations = useAsyncResource(() => searchFormulations("", 50), []);

  const save = useAsyncAction(async () => {
    const values = await form.validateFields();
    const { experiment } = await saveExperimentWithPerformance(values);
    message.success(`${t("ui.experimentSavedTo")} ${experiment.id}`);
    form.resetFields();
  }, {
    onError: (error) => {
      // A validation rejection from Ant Design has no backend code; it is already shown against
      // the offending field, so only a real failure is worth a toast.
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(backendErrorText(error, t));
    }
  });

  const testTypeOptions = TEST_TYPES.map((item) => ({
    value: item.value,
    label: item.labelKey ? t(item.labelKey) : item.value
  }));

  return (
    <div className="page-grid experiment-page experiment-entry-only-page">
      <PageHeader
        title={t("ui.experimentsPerformance")}
        description={t("ui.recordTestConditionsPerformanceResultsAndAtt")}
      />
      <Card title={t("ui.experimentEntry")}>
        <Alert type="info" showIcon message={t("entry.noAssumedValues")} style={{ marginBottom: 16 }} />
        <AsyncBoundary
          loading={formulations.loading}
          error={formulations.error}
          onRetry={formulations.reload}
          rows={2}
        >
          <Form
            form={form}
            layout="vertical"
            // No `initialValues`. Every field here is a measurement or a choice, and the units are
            // shown as fixed adornments beside the number rather than as pre-filled values.
          >
            <div className="experiment-form-grid">
              <Form.Item
                label={t("ui.formulation")}
                name="formulationId"
                rules={[{ required: true, message: t("ui.selectAFormulation") }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={(formulations.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.label
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t("ui.testType")}
                name="testType"
                rules={[{ required: true, message: t("entry.testTypeRequired") }]}
              >
                <Select placeholder={t("ui.selectATestType")} options={testTypeOptions} />
              </Form.Item>
              <Form.Item label={t("ui.testStandard")} name="testStandard"><Input /></Form.Item>
              <Form.Item label={t("ui.instrument")} name="instrument"><Input /></Form.Item>
              <Form.Item label={t("ui.upperSpecimenMaterial")} name="upperMaterial"><Input /></Form.Item>
              <Form.Item label={t("ui.lowerSpecimenMaterial")} name="lowerMaterial"><Input /></Form.Item>
              <Form.Item label={t("ui.experimentDate")} name="experimentDate"><Input type="date" /></Form.Item>
              <Form.Item label={t("ui.operator")} name="operator"><Input /></Form.Item>
              <Form.Item label={t("ui.load")} name="loadValue">
                <InputNumber addonAfter="N" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.temperature")} name="temperatureValue">
                <InputNumber addonAfter="C" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.duration")} name="durationValue">
                <InputNumber min={0} addonAfter="min" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.averageFrictionCoefficient")} name="averageFrictionCoefficient">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.stableFrictionCoefficient")} name="stableFrictionCoefficient">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.wearScarDiameter")} name="wearScarDiameterValue">
                <InputNumber addonAfter="um" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.initialOxidationTemperature")} name="initialOxidationTemperatureValue">
                <InputNumber addonAfter="C" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.extremePressureValue")} name="extremePressureValue">
                <InputNumber addonAfter="N" style={{ width: "100%" }} />
              </Form.Item>
              {/* Blank by default. A pre-filled "3" claims the test was run three times, which is
                  a number nobody entered and one the analysis later weights results by. */}
              <Form.Item label={t("ui.repeatCount")} name="repeatCount">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label={t("ui.notes")} name="notes"><Input /></Form.Item>
              <Form.Item label={t("ui.actions")}>
                <Button type="primary" block loading={save.running} onClick={() => void save.run()}>
                  {t("ui.saveExperimentAndPerformance")}
                </Button>
              </Form.Item>
            </div>
          </Form>
          <Typography.Text type="secondary">{t("import.transactional")}</Typography.Text>
        </AsyncBoundary>
      </Card>
    </div>
  );
}
