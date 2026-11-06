import { DownloadOutlined, FileSearchOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Space, Table, Typography, message } from "antd";
import { useState } from "react";
import {
  exportWorkspaceArchive, importWorkspaceArchive, openWorkspace, previewWorkspaceArchive,
  type WorkspaceArchive, type WorkspaceArchiveImport
} from "../../lib/api";
import { chooseFile, chooseFolder, chooseSaveDestination, nativeDialogsAvailable } from "../../lib/dialogs";
import { useAsyncAction } from "../../lib/useAsyncResource";
import { backendErrorText } from "../../lib/backendErrors";
import { useLanguage } from "../../i18n/LanguageContext";

const FILTERS = [{ name: "LMD ZIP", extensions: ["zip"] }];

export default function WorkspaceArchiveCard() {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<WorkspaceArchive>();
  const [exported, setExported] = useState<WorkspaceArchive>();
  const [imported, setImported] = useState<WorkspaceArchiveImport>();
  const onError = (error: unknown) => message.error(backendErrorText(error, t));
  const exportAction = useAsyncAction(async () => {
    const path = await chooseSaveDestination({
      title: t("archive.export"), defaultPath: `LMD-${new Date().toISOString().slice(0, 10)}.zip`, filters: FILTERS
    });
    if (!path) return;
    setExported(undefined);
    setExported(await exportWorkspaceArchive(path));
  }, { onError });
  const previewAction = useAsyncAction(async () => {
    const path = await chooseFile({ title: t("archive.select"), filters: FILTERS });
    if (!path) return;
    setPreview(undefined);
    setImported(undefined);
    setPreview(await previewWorkspaceArchive(path));
  }, { onError });
  const importAction = useAsyncAction(async (selected: WorkspaceArchive) => {
    const parent = await chooseFolder({ title: t("archive.destination") });
    if (!parent) return;
    setImported(await importWorkspaceArchive(selected, parent));
    setPreview(undefined);
  }, { onError });
  const openAction = useAsyncAction(async (path: string) => {
    await openWorkspace(path);
    window.location.reload();
  }, { onError });
  const busy = exportAction.running || previewAction.running || importAction.running || openAction.running;

  return (
    <Card title={t("archive.title")} className="table-card">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Paragraph>{t("archive.description")}</Typography.Paragraph>
        <Alert type="info" showIcon message={t("archive.scope")} description={t("archive.preserve")} />
        <Space wrap>
          <Button type="primary" icon={<DownloadOutlined />} disabled={!nativeDialogsAvailable() || busy}
            loading={exportAction.running} onClick={() => void exportAction.run()}>{t("archive.export")}</Button>
          <Button icon={<FileSearchOutlined />} disabled={!nativeDialogsAvailable() || busy}
            loading={previewAction.running} onClick={() => void previewAction.run()}>{t("archive.select")}</Button>
          {!nativeDialogsAvailable() ? <Typography.Text type="secondary">{t("dialog.unavailable")}</Typography.Text> : null}
        </Space>
        {exported ? <Alert type="success" showIcon message={t("archive.exported")}
          description={<span translate="no">{exported.path}</span>} /> : null}
        {preview ? <>
          <Alert type="warning" showIcon message={t("archive.preview")} description={t("archive.trust")} />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t("workspace.backupFile")}><span translate="no">{preview.path}</span></Descriptions.Item>
            <Descriptions.Item label={t("workspace.schemaVersion")}>{preview.manifest.schemaVersion}</Descriptions.Item>
            <Descriptions.Item label={t("archive.createdAt")}>{preview.manifest.createdAt}</Descriptions.Item>
            <Descriptions.Item label={t("archive.platform")}>{preview.manifest.sourcePlatform}</Descriptions.Item>
            <Descriptions.Item label={t("archive.files")}>{preview.manifest.files.length}</Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey="name" pagination={{ pageSize: 8 }}
            dataSource={Object.entries(preview.manifest.tableCounts).map(([name, count]) => ({ name, count }))}
            columns={[
              { title: t("archive.table"), dataIndex: "name", render: (name: string) => <span translate="no">{name}</span> },
              { title: t("archive.records"), dataIndex: "count" }
            ]} />
          <Space>
            <Button type="primary" icon={<UploadOutlined />} disabled={busy} loading={importAction.running}
              onClick={() => void importAction.run(preview)}>{t("archive.import")}</Button>
            <Button disabled={busy} onClick={() => setPreview(undefined)}>{t("import.cancelAction")}</Button>
          </Space>
        </> : null}
        {imported ? <Alert type="success" showIcon message={t("archive.imported")}
          description={<span translate="no">{imported.workspacePath}</span>}
          action={<Button disabled={busy} loading={openAction.running}
            onClick={() => void openAction.run(imported.workspacePath)}>{t("archive.open")}</Button>} /> : null}
      </Space>
    </Card>
  );
}
