import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import AsyncBoundary from "../../components/AsyncBoundary";
import {
  checkDatabaseIntegrity,
  createWorkspace,
  createWorkspaceBackup,
  getWorkspaceDetails,
  listRowsNeedingAttention,
  listWorkspaceBackups,
  openWorkspace,
  restoreWorkspaceBackup
} from "../../lib/api";
import type { BackupRecord, IntegrityReport } from "../../types";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { chooseFolder, nativeDialogsAvailable } from "../../lib/dialogs";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";

/**
 * Bytes, in the units a person reads.
 *
 * The unit symbols are not translated. `B`, `KB`, `MB` and `GB` are written the same way in
 * Chinese and Japanese interfaces, and putting them in the catalogue would invite a translation
 * that made a file size harder to read rather than easier.
 */
function formatBytes(bytes: number) {
  // i18n-exempt: a byte-count symbol, identical in all three languages.
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Where the workspace is, whether it is sound, and how to get back to a known-good copy of it.
 *
 * Everything here was previously invisible: the database path existed only in a status bar, an
 * integrity check could not be run at all, and the only backups were the ones a user thought to
 * make by copying `lmd.sqlite` — which, in WAL mode, does not copy the most recent transactions.
 */
export default function WorkspaceCard() {
  const { t } = useLanguage();
  const [integrity, setIntegrity] = useState<IntegrityReport>();
  const [pendingWorkspace, setPendingWorkspace] = useState<string>();

  const details = useAsyncResource(() => getWorkspaceDetails(), []);
  const backups = useAsyncResource(() => listWorkspaceBackups(), []);
  const attention = useAsyncResource(() => listRowsNeedingAttention(), []);

  function refreshAll() {
    details.reload();
    backups.reload();
    attention.reload();
  }

  const check = useAsyncAction(async () => {
    const report = await checkDatabaseIntegrity();
    setIntegrity(report);
    if (report.ok) message.success(t("workspace.integrityOk"));
    else message.warning(t("workspace.integrityFailed"));
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  const backup = useAsyncAction(async () => {
    await createWorkspaceBackup();
    message.success(t("workspace.backupCreated"));
    refreshAll();
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  /**
   * Switching workspace reloads the window rather than refetching.
   *
   * Every page holds records from the workspace that was open when it mounted. Refreshing them one
   * by one would leave whichever screens are not currently rendered still holding the old ones,
   * and a stale molecule list from a different workspace is worse than a moment's reload.
   */
  const switchWorkspace = useAsyncAction(async (mode: "create" | "open") => {
    const path = await chooseFolder({ title: t("workspace.chooseFolderTitle") });
    if (!path) {
      message.info(t("dialog.cancelled"));
      return;
    }
    if (mode === "create") await createWorkspace(path);
    else await openWorkspace(path);
    message.success(mode === "create" ? t("workspace.created") : t("workspace.opened"));
    setPendingWorkspace(path);
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  const restore = useAsyncAction(async (record: BackupRecord) => {
    await restoreWorkspaceBackup(record.path, true);
    message.success(t("workspace.restored", { path: record.fileName }));
    setPendingWorkspace(record.path);
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  function confirmRestore(record: BackupRecord) {
    Modal.confirm({
      title: t("workspace.restoreConfirmTitle"),
      content: t("workspace.restoreConfirmBody"),
      okText: t("workspace.restore"),
      okButtonProps: { danger: true },
      cancelText: t("ui.cancel"),
      onOk: () => restore.run(record)
    });
  }

  const backupColumns: ColumnsType<BackupRecord> = [
    {
      title: t("workspace.backupFile"),
      dataIndex: "fileName",
      // A file name on disk is data, not interface text.
      render: (value: string) => <span translate="no">{value}</span>
    },
    {
      title: t("workspace.backupKind"),
      dataIndex: "automatic",
      width: 130,
      render: (automatic: boolean) => (
        <Tag color={automatic ? "blue" : "green"}>
          {automatic ? t("workspace.backupAutomatic") : t("workspace.backupManual")}
        </Tag>
      )
    },
    {
      title: t("workspace.backupSize"),
      dataIndex: "sizeBytes",
      width: 120,
      render: (value: number) => formatBytes(value)
    },
    {
      title: t("workspace.actions"),
      key: "actions",
      width: 140,
      render: (_, record) => (
        <Button size="small" danger loading={restore.running} onClick={() => confirmRestore(record)}>
          {t("workspace.restore")}
        </Button>
      )
    }
  ];

  const attentionColumns: ColumnsType<{ tableName: string; rowId: string; rule: string; detail: string }> = [
    { title: t("workspace.attentionTable"), dataIndex: "tableName", render: (value: string) => <span translate="no">{value}</span> },
    { title: t("workspace.attentionRow"), dataIndex: "rowId", render: (value: string) => <span translate="no">{value}</span> },
    { title: t("workspace.attentionRule"), dataIndex: "detail" }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title={t("workspace.title")} extra={<Typography.Text type="secondary">{t("workspace.description")}</Typography.Text>}>
        <AsyncBoundary loading={details.loading} error={details.error} onRetry={details.reload} rows={3}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t("workspace.currentPath")}>
              {/* A path on this machine: shown exactly as it is. */}
              <span translate="no">{details.data?.workspacePath}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.databasePath")}>
              <span translate="no">{details.data?.databasePath}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.databaseSize")}>
              {details.data?.databaseExists
                ? formatBytes(details.data.databaseSizeBytes)
                : t("workspace.databaseMissing")}
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.schemaVersion")}>
              {`${details.data?.schemaVersion ?? 0} / ${details.data?.supportedSchemaVersion ?? 0}`}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            {t("workspace.schemaVersionHelp", { supported: details.data?.supportedSchemaVersion ?? 0 })}
          </Typography.Paragraph>

          <Space wrap>
            <Button
              disabled={!nativeDialogsAvailable()}
              loading={switchWorkspace.running}
              onClick={() => void switchWorkspace.run("create")}
            >
              {t("workspace.create")}
            </Button>
            <Button
              disabled={!nativeDialogsAvailable()}
              loading={switchWorkspace.running}
              onClick={() => void switchWorkspace.run("open")}
            >
              {t("workspace.open")}
            </Button>
            <Button loading={check.running} onClick={() => void check.run()}>
              {t("workspace.integrityCheck")}
            </Button>
            {!nativeDialogsAvailable() ? (
              <Typography.Text type="secondary">{t("dialog.unavailable")}</Typography.Text>
            ) : null}
          </Space>

          {pendingWorkspace ? (
            <Alert
              style={{ marginTop: 16 }}
              type="warning"
              showIcon
              message={t("workspace.switchWarning")}
              action={
                <Button size="small" type="primary" onClick={() => window.location.reload()}>
                  {t("workspace.reloadNow")}
                </Button>
              }
            />
          ) : null}

          {integrity ? (
            <Alert
              style={{ marginTop: 16 }}
              type={integrity.ok ? "success" : "error"}
              showIcon
              message={integrity.ok ? t("workspace.integrityOk") : t("workspace.integrityFailed")}
              description={
                <Space direction="vertical" size={4}>
                  {/* SQLite's own answer, quoted rather than paraphrased. */}
                  <span translate="no">{integrity.integrity}</span>
                  <span>{`${t("workspace.foreignKeyViolations")}: ${integrity.foreignKeyViolations}`}</span>
                </Space>
              }
            />
          ) : null}
        </AsyncBoundary>
      </Card>

      <Card
        title={t("workspace.backups")}
        extra={
          <Button type="primary" loading={backup.running} onClick={() => void backup.run()}>
            {t("workspace.backupCreate")}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          {t("workspace.backupRetentionHelp")}
        </Typography.Paragraph>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label={t("workspace.backupRetention")}>
            {details.data?.automaticBackupLimit ?? 0}
          </Descriptions.Item>
        </Descriptions>
        <AsyncBoundary loading={backups.loading} error={backups.error} onRetry={backups.reload} rows={2}>
          <Table
            size="small"
            rowKey={(row) => row.path}
            columns={backupColumns}
            dataSource={backups.data ?? []}
            locale={{ emptyText: t("workspace.backupNone") }}
            pagination={{ pageSize: 8 }}
          />
        </AsyncBoundary>
      </Card>

      {(attention.data?.length ?? 0) > 0 ? (
        <Card title={t("workspace.rowsNeedingAttention")}>
          <Alert
            type="warning"
            showIcon
            message={t("workspace.rowsNeedingAttention")}
            description={t("workspace.rowsNeedingAttentionHelp")}
            style={{ marginBottom: 12 }}
          />
          <Table
            size="small"
            rowKey={(row) => `${row.tableName}-${row.rowId}-${row.rule}`}
            columns={attentionColumns}
            dataSource={attention.data ?? []}
            pagination={{ pageSize: 10 }}
          />
        </Card>
      ) : null}
    </Space>
  );
}
