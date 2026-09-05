import PagedModal from "../../../components/PagedModal";
import { Alert, Button, Empty, Input, Modal, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import LoadingBlock from "../../../components/LoadingBlock";
import { deleteAttachmentRecord, exportWorkspaceFile, importAttachment, listMoleculeFiles } from "../../../lib/api";
import { useLanguage } from "../../../i18n/LanguageContext";
import { isTauriRuntime } from "../../../lib/tauri";
import { ATTACHMENT_FILTERS, chooseFile, chooseSaveDestination } from "../../../lib/dialogs";
import type { AttachmentRecord, Molecule, WorkspaceFile } from "../../../types";
import { backendErrorText, parseBackendError } from "../../../lib/backendErrors";

function formatBytes(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Structure files and attachment records for one molecule, read from the workspace database.
 * Every path shown here is stored in SQLite; none are fixed in the frontend.
 */
export default function MoleculeFilesPanel({ molecule }: { molecule: Molecule }) {
  const [structureFiles, setStructureFiles] = useState<WorkspaceFile[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const { t } = useLanguage();
  const desktop = isTauriRuntime();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listMoleculeFiles(molecule.id);
      setStructureFiles(result.structureFiles);
      setAttachments(result.attachments);
    } catch (caught) {
      // Stored raw and translated at render, so a switch of language re-reads it.
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [molecule.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Saves a workspace file wherever the user chooses.
   *
   * This used to be `window.prompt` for the destination and `window.confirm` for the overwrite.
   * Inside a Tauri webview both are platform dialogs with no styling, no localisation and no file
   * browser — so the "destination" was an absolute path the user had to type from memory, and a
   * typo became a backend error about a directory that does not exist.
   */
  async function exportFile(relativePath: string, suggestedName: string) {
    const destination = await chooseSaveDestination({
      title: t("dialog.chooseDestination"),
      defaultPath: suggestedName
    });
    if (!destination) {
      message.info(t("dialog.cancelled"));
      return;
    }
    const target = destination;
    try {
      await exportWorkspaceFile(relativePath, target, false);
      message.success(`${t("files.exported")} ${target}`);
    } catch (caught) {
      const parsed = parseBackendError(caught);
      // The backend refuses to clobber silently; ask, then retry with explicit consent.
      if (parsed.code === "file.alreadyExists") {
        Modal.confirm({
          title: t("files.exportOverwrite"),
          okText: t("ui.continue"),
          okButtonProps: { danger: true },
          cancelText: t("ui.cancel"),
          onOk: async () => {
            try {
              await exportWorkspaceFile(relativePath, target, true);
              message.success(`${t("files.exported")} ${target}`);
            } catch (retry) {
              message.error(backendErrorText(retry, t));
            }
          }
        });
        // Declining an overwrite is a normal cancellation, not another failure to report.
        return;
      }
      message.error(backendErrorText(caught, t));
    }
  }

  async function attachFile() {
    if (!sourcePath.trim()) {
      message.warning(t("files.sourceRequired"));
      return;
    }
    setBusy(true);
    try {
      await importAttachment({
        linkedEntityType: "molecule",
        linkedEntityId: molecule.id,
        sourcePath: sourcePath.trim(),
        description: description.trim() || undefined
      });
      setAttachOpen(false);
      setSourcePath("");
      setDescription("");
      // Re-read from SQLite rather than assuming the local list is authoritative.
      await refresh();
      message.success(t("files.attached"));
    } catch (caught) {
      message.error(backendErrorText(caught, t));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(row: AttachmentRecord) {
    Modal.confirm({
      title: t("files.deleteConfirmTitle"),
      content: (
        <span>
          <span translate="no">{row.fileName}</span> — {t("files.deleteConfirmBody")}
        </span>
      ),
      okText: t("files.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await deleteAttachmentRecord(row.id);
          await refresh();
          if (result.cleanupFailures.length > 0) {
            // The row is gone either way. Saying "Deleted" alone would hide a file still on disk.
            Modal.warning({
              title: t("files.cleanupWarningTitle"),
              content: (
                <span>
                  {t("files.cleanupWarningBody")}
                  <ul style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
                    {result.cleanupFailures.map((failure) => (
                      <li key={failure} translate="no">
                        {failure}
                      </li>
                    ))}
                  </ul>
                </span>
              )
            });
            return;
          }
          message.success(t("files.deleted"));
        } catch (caught) {
          message.error({ content: `${t("files.deleteFailed")}: ${backendErrorText(caught, t)}` });
        }
      }
    });
  }

  const structureColumns: ColumnsType<WorkspaceFile> = [
    { title: t("files.type"), dataIndex: "kind", width: 90, render: (value) => <Tag>{value}</Tag> },
    {
      title: t("files.path"),
      dataIndex: "relativePath",
      render: (value: string) => <span translate="no">{value}</span>
    },
    { title: t("files.size"), dataIndex: "bytes", width: 110, render: formatBytes },
    {
      title: t("files.status"),
      dataIndex: "exists",
      width: 120,
      render: (exists: boolean) =>
        exists ? <Tag color="green">{t("files.present")}</Tag> : <Tag color="red">{t("files.missing")}</Tag>
    },
    {
      title: t("files.actions"),
      width: 120,
      render: (_, row) => (
        <Button
          size="small"
          disabled={!desktop || !row.exists}
          onClick={() => exportFile(row.relativePath, `${molecule.id}.${row.kind.toLowerCase()}`)}
        >
          {t("files.export")}
        </Button>
      )
    }
  ];

  const attachmentColumns: ColumnsType<AttachmentRecord> = [
    {
      title: t("files.fileName"),
      dataIndex: "fileName",
      render: (value: string) => <span translate="no">{value}</span>
    },
    {
      title: t("files.path"),
      dataIndex: "relativePath",
      render: (value: string) => <span translate="no">{value}</span>
    },
    { title: t("files.size"), dataIndex: "bytes", width: 110, render: formatBytes },
    { title: t("files.attachedAt"), dataIndex: "uploadedAt", width: 200 },
    {
      title: t("files.status"),
      dataIndex: "exists",
      width: 120,
      render: (exists: boolean) =>
        exists ? <Tag color="green">{t("files.present")}</Tag> : <Tag color="red">{t("files.missing")}</Tag>
    },
    {
      title: t("files.actions"),
      width: 180,
      render: (_, row) => (
        <Space size={6}>
          <Button
            size="small"
            disabled={!desktop || !row.exists}
            onClick={() => exportFile(row.relativePath, row.fileName)}
          >
            {t("files.export")}
          </Button>
          <Button size="small" danger disabled={!desktop} onClick={() => confirmDelete(row)}>
            {t("files.delete")}
          </Button>
        </Space>
      )
    }
  ];

  if (loading) return <LoadingBlock />;
  if (error) {
    return <Alert type="error" showIcon message={t("files.loadFailed")} description={backendErrorText(error, t)} />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={5}>{t("files.structureTitle")}</Typography.Title>
        {structureFiles.length === 0 ? (
          <Empty description={t("files.noStructureFiles")} />
        ) : (
          <Table
            size="small"
            rowKey="relativePath"
            columns={structureColumns}
            dataSource={structureFiles}
            pagination={false}
          />
        )}
      </div>

      <div>
        <Space style={{ marginBottom: 8 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t("files.attachmentsTitle")}
          </Typography.Title>
          <Tooltip title={desktop ? undefined : t("files.desktopOnly")}>
            <Button size="small" type="primary" disabled={!desktop} onClick={() => setAttachOpen(true)}>
              {t("files.attach")}
            </Button>
          </Tooltip>
        </Space>
        {attachments.length === 0 ? (
          <Empty description={t("files.noAttachments")} />
        ) : (
          <Table size="small" rowKey="id" columns={attachmentColumns} dataSource={attachments} pagination={false} />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {t("files.openUnavailable")}
        </Typography.Paragraph>
      </div>

      <PagedModal
        title={t("files.attachTitle")}
        open={attachOpen}
        confirmLoading={busy}
        okText={t("files.attach")}
        onCancel={() => setAttachOpen(false)}
        onOk={attachFile}
      >
        <Typography.Paragraph type="secondary">{t("files.attachExplanation")}</Typography.Paragraph>
        <Typography.Text>{t("files.sourcePath")}</Typography.Text>
        <Space.Compact style={{ width: "100%" }}>
          {/* Read-only: the path comes from the picker, so it cannot be a path that does not
              exist or one belonging to a different machine. */}
          <Input data-testid="attachment-source" value={sourcePath} readOnly />
          <Button
            disabled={!desktop}
            onClick={async () => {
              const chosen = await chooseFile({
                title: t("dialog.chooseFile"),
                filters: ATTACHMENT_FILTERS
              });
              if (chosen) setSourcePath(chosen);
            }}
          >
            {t("dialog.browse")}
          </Button>
        </Space.Compact>
        <Typography.Text style={{ display: "block", marginTop: 12 }}>{t("files.description")}</Typography.Text>
        <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      </PagedModal>
    </Space>
  );
}
