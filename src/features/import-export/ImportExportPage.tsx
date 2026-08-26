import { DownloadOutlined, FileSearchOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Descriptions, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import {
  confirmTableImport,
  deliverExport,
  describeExport,
  exportMlDescriptorMatrixCsv,
  exportMoleculeLibraryCsv,
  previewTableImport
} from "../../lib/api";
import type { ImportOutcome, ImportPreview, MLDescriptorMatrixOptions, RejectedRow } from "../../types";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { chooseFile, nativeDialogsAvailable, TABLE_FILTERS } from "../../lib/dialogs";
import { useAsyncAction } from "../../lib/useAsyncResource";

type PreviewRow = Record<string, unknown>;

/** The record types the importer recognises, as translation keys rather than English words. */
const KIND_LABEL_KEYS = {
  base_oils: "ui.baseOil",
  additives: "ui.additives"
} as const satisfies Record<string, MessageKey>;

export default function ImportExportPage() {
  const { t } = useLanguage();
  const [numericOnly, setNumericOnly] = useState(true);
  const [preview, setPreview] = useState<ImportPreview>();
  const [outcome, setOutcome] = useState<ImportOutcome>();

  /**
   * Stage one. Reads the file and reports what an import *would* do.
   *
   * Nothing is written here, and the panel below says so in as many words: the previous single
   * command had already stored every row by the time these same numbers appeared on screen.
   */
  const previewAction = useAsyncAction(async () => {
    const path = await chooseFile({ title: t("import.selectFile"), filters: TABLE_FILTERS });
    if (!path) {
      message.info(t("dialog.cancelled"));
      return;
    }
    setOutcome(undefined);
    setPreview(await previewTableImport(path));
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  /** Stage two. Writes the reviewed rows in one transaction, or none of them. */
  const importAction = useAsyncAction(async (selected: ImportPreview) => {
    const result = await confirmTableImport(selected);
    setOutcome(result);
    setPreview(undefined);
    message.success(`${t("import.resultTitle")} — ${t("import.imported")} ${result.importedCount}`);
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  const previewRows = preview?.previewRows ?? [];
  const columns = useMemo<ColumnsType<PreviewRow>>(() => {
    const keys = (preview?.columns ?? []).slice(0, 8);
    return keys.map((key) => ({
      title: <span translate="no">{key}</span>,
      dataIndex: key,
      ellipsis: true,
      // Spreadsheet cells are the user's data; they are shown exactly as they were read.
      render: (value) => <span translate="no">{String(value ?? "")}</span>
    }));
  }, [preview]);

  const rejectedColumns: ColumnsType<RejectedRow> = [
    { title: t("import.rejectedRow"), dataIndex: "row", width: 100 },
    {
      title: t("import.rejectedReason"),
      dataIndex: "reason",
      render: (value: string) => <span translate="no">{value}</span>
    }
  ];

  async function exportMolecules() {
    const result = await exportMoleculeLibraryCsv();
    deliverExport(result);
    message.success(
      describeExport(result, t("ui.moleculeLibraryExport"), {
        savedTo: t("ui.exportedRowsTo"),
        exported: t("ui.exportedShort")
      })
    );
  }

  async function exportDescriptors() {
    const options: MLDescriptorMatrixOptions = {
      includeRdkit: true,
      includeMordred: true,
      numericOnly,
      includeMetadata: true,
      missingValueStrategy: "blank",
      descriptorPrefix: true
    };
    const result = await exportMlDescriptorMatrixCsv(options);
    deliverExport(result);
    message.success(
      describeExport(result, t("ui.descriptorMatrixExport"), {
        savedTo: t("ui.exportedRowsTo"),
        exported: t("ui.exportedShort")
      })
    );
  }

  const kindKey = preview ? KIND_LABEL_KEYS[preview.detectedKind as keyof typeof KIND_LABEL_KEYS] : undefined;

  return (
    <div className="page-grid">
      <PageHeader title={t("ui.importExport")} description={t("ui.importMoleculeTablesAndExportTheMoleculeLibr")} />

      <Card className="table-card">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Button
              type="primary"
              icon={<FileSearchOutlined />}
              loading={previewAction.running}
              disabled={!nativeDialogsAvailable()}
              onClick={() => void previewAction.run()}
            >
              {t("import.selectFile")}
            </Button>
            {!nativeDialogsAvailable() ? (
              <Typography.Text type="secondary">{t("dialog.unavailable")}</Typography.Text>
            ) : null}
          </Space>

          {preview ? (
            <>
              <Alert
                type="info"
                showIcon
                message={t("import.previewTitle")}
                description={t("import.previewNothingWritten")}
              />
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label={t("workspace.backupFile")}>
                  <span translate="no">{preview.fileName}</span>
                </Descriptions.Item>
                <Descriptions.Item label={t("import.detectedType")}>
                  {kindKey ? <Tag color="blue">{t(kindKey)}</Tag> : <Tag>{t("import.detectedTypeUnknown")}</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label={t("import.columns")}>
                  <span translate="no">{preview.columns.join(", ")}</span>
                </Descriptions.Item>
                <Descriptions.Item label={t("import.rowCount")}>{previewRows.length}</Descriptions.Item>
              </Descriptions>

              {preview.warnings.length ? (
                <Alert
                  type="warning"
                  showIcon
                  message={t("import.warnings")}
                  description={
                    <ul>
                      {preview.warnings.map((warning) => (
                        // The backend's own diagnostic, shown verbatim.
                        <li key={warning} translate="no">{warning}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}

              {previewRows.length ? (
                <Table
                  size="small"
                  rowKey={(_, index) => String(index)}
                  columns={columns}
                  dataSource={previewRows as PreviewRow[]}
                  pagination={false}
                  scroll={{ x: true }}
                />
              ) : null}

              <Typography.Text type="secondary">{t("import.transactional")}</Typography.Text>
              <Space>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  loading={importAction.running}
                  disabled={!preview.importable}
                  onClick={() => void importAction.run(preview)}
                >
                  {t("import.confirmAction")}
                </Button>
                <Button onClick={() => setPreview(undefined)}>{t("import.cancelAction")}</Button>
              </Space>
            </>
          ) : null}

          {outcome ? (
            <>
              <Alert
                type={outcome.rejected.length ? "warning" : "success"}
                showIcon
                message={t("import.resultTitle")}
                description={[
                  `${t("import.imported")}: ${outcome.importedCount}`,
                  `${t("import.skipped")}: ${outcome.skippedCount}`,
                  `${t("import.createdMolecules")}: ${outcome.createdMoleculeCount}`,
                  `${t("import.rejected")}: ${outcome.rejected.length}`
                ].join("; ")}
              />
              {outcome.rejected.length ? (
                <Table
                  size="small"
                  rowKey={(row) => String(row.row)}
                  columns={rejectedColumns}
                  dataSource={outcome.rejected}
                  pagination={{ pageSize: 10 }}
                />
              ) : null}
            </>
          ) : null}
        </Space>
      </Card>

      <Card className="table-card">
        <div className="table-toolbar">
          <div className="left">
            <Button icon={<DownloadOutlined />} onClick={() => void exportMolecules()}>
              {t("ui.exportMoleculeLibraryCsv")}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void exportDescriptors()}>
              {t("ui.exportDescriptorMatrixCsv")}
            </Button>
          </div>
          <div className="right">
            <Checkbox checked={numericOnly} onChange={(event) => setNumericOnly(event.target.checked)}>
              {t("ui.numericOnly")}
            </Checkbox>
          </div>
        </div>
      </Card>
    </div>
  );
}
