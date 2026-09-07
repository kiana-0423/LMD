import { Alert, Button, Card, Form, Select, message } from "antd";
import PageHeader from "../../components/PageHeader";
import AsyncBoundary from "../../components/AsyncBoundary";
import { saveExperimentWithPerformance, searchFormulations } from "../../lib/api";
import type { ExperimentPerformancePayload } from "../../lib/api";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";

import ExperimentFields from "./ExperimentFields";
import { experimentPayload } from "../../lib/experimentProtocol";

export default function ExperimentPerformancePage() {
  const { t } = useLanguage();
  const [form] = Form.useForm<ExperimentPerformancePayload>();

  // A search endpoint rather than the whole table: a workspace with a thousand blends should not
  // download all of them to populate one dropdown.
  const formulations = useAsyncResource(() => searchFormulations("", 50), []);

  const save = useAsyncAction(async () => {
    const values = await form.validateFields();
    const { experiment } = await saveExperimentWithPerformance(experimentPayload(values as unknown as Record<string, unknown>) as unknown as ExperimentPerformancePayload);
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

  return (
    <div className="page-grid experiment-page experiment-entry-only-page">
      <PageHeader
        title={t("ui.experimentsPerformance")}
        description={t("ui.recordTestConditionsPerformanceResultsAndAtt")}
      />
      <Card title={t("ui.experimentEntry")} extra={<Button type="primary" loading={save.running} onClick={() => void save.run()}>{t("ui.saveExperimentAndPerformance")}</Button>}>
        <Alert type="info" showIcon message={t("test.entryHelp")} style={{ marginBottom: 16 }} />
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
            <ExperimentFields leading={
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
            } />
          </Form>
        </AsyncBoundary>
      </Card>
    </div>
  );
}
