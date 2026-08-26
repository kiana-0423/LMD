import { Alert, Button, Card, Descriptions, Space, Typography, message } from "antd";
import { useState } from "react";
import { exportDiagnostics, getDiagnostics } from "../../lib/api";
import type { DiagnosticsReport } from "../../types";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncAction } from "../../lib/useAsyncResource";

/**
 * The report a user sends when the application will not start properly.
 *
 * It is shown before it is written, so nobody has to send a file to find out what is in it. What
 * is in it is versions, paths, counts and error messages — and the note beside the button says
 * exactly that, because "export diagnostics" is otherwise a reasonable thing to be wary of when
 * your workspace contains unpublished chemistry.
 */
export default function DiagnosticsCard() {
  const { t } = useLanguage();
  const [report, setReport] = useState<DiagnosticsReport>();

  const load = useAsyncAction(async () => {
    setReport(await getDiagnostics());
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  const save = useAsyncAction(async () => {
    const written = await exportDiagnostics();
    message.success(t("diagnostics.exported", { path: written.displayPath }));
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  return (
    <Card title={t("diagnostics.title")}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary">{t("diagnostics.description")}</Typography.Paragraph>
        <Alert type="info" showIcon message={t("diagnostics.privacyNote")} />
        <Space wrap>
          <Button loading={load.running} onClick={() => void load.run()}>
            {t("diagnostics.view")}
          </Button>
          <Button type="primary" loading={save.running} onClick={() => void save.run()}>
            {t("diagnostics.export")}
          </Button>
        </Space>
        {report ? (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t("diagnostics.version")}>
              <span translate="no">{report.applicationVersion}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("diagnostics.platform")}>
              <span translate="no">{`${report.platform} ${report.architecture}`}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.currentPath")}>
              <span translate="no">{report.workspacePath}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.schemaVersion")}>
              {`${report.schemaVersion} / ${report.supportedSchemaVersion}`}
            </Descriptions.Item>
            <Descriptions.Item label={t("diagnostics.sidecarMode")}>
              <span translate="no">{String((report.sidecar as { mode?: string })?.mode ?? "-")}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.rowsNeedingAttention")}>
              {report.rowsNeedingAttention}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Space>
    </Card>
  );
}
