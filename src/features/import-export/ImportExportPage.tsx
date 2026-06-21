import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Input, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { exportMlDescriptorMatrixCsv, exportMoleculeLibraryCsv, importExcelWithSidecar } from "../../lib/api";
import { downloadTextFile } from "../../lib/downloads";
import type { MLDescriptorMatrixOptions } from "../../types";

type PreviewRow = Record<string, unknown>;

function normalizePreviewRows(result: Record<string, unknown>): PreviewRow[] {
  const rows = result.preview_rows ?? result.previewRows;
  return Array.isArray(rows) ? rows.filter((row): row is PreviewRow => typeof row === "object" && row !== null) : [];
}

export default function ImportExportPage() {
  const [filePath, setFilePath] = useState("");
  const [numericOnly, setNumericOnly] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const previewRows = useMemo(() => (result ? normalizePreviewRows(result) : []), [result]);
  const columns = useMemo<ColumnsType<PreviewRow>>(() => {
    const keys = Array.from(new Set(previewRows.flatMap((row) => Object.keys(row)))).slice(0, 8);
    return keys.map((key) => ({
      title: key,
      dataIndex: key,
      ellipsis: true,
      render: (value) => <span>{String(value ?? "")}</span>
    }));
  }, [previewRows]);

  async function importFile() {
    if (!filePath.trim()) {
      message.warning("请输入本地 Excel/CSV 文件路径。");
      return;
    }
    setImporting(true);
    try {
      const response = await importExcelWithSidecar(filePath.trim());
      setResult(response);
      message.success("导入任务已完成。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function exportMolecules() {
    const content = await exportMoleculeLibraryCsv();
    downloadTextFile("molecule-library.csv", content, "text/csv;charset=utf-8");
    message.success("已导出分子库 CSV。");
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
    const content = await exportMlDescriptorMatrixCsv(options);
    downloadTextFile("descriptor-matrix.csv", content, "text/csv;charset=utf-8");
    message.success("已导出描述符矩阵 CSV。");
  }

  return (
    <div className="page-grid">
      <PageHeader title="导入/导出" description="导入分子表，导出分子库和描述符矩阵。" />
      <Card className="table-card">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="Excel/CSV 文件路径" />
            <Button type="primary" icon={<UploadOutlined />} loading={importing} onClick={importFile}>
              导入
            </Button>
          </Space.Compact>
          {result ? (
            <Alert
              type="success"
              showIcon
              message="导入结果"
              description={
                <Typography.Text>
                  类型 {String(result.import_kind ?? result.importKind ?? "preview_only")}，
                  写入 {String(result.imported_count ?? result.importedCount ?? 0)} 条，
                  自动创建分子 {String(result.created_molecule_count ?? result.createdMoleculeCount ?? 0)} 条，
                  跳过 {String(result.skipped_count ?? result.skippedCount ?? 0)} 条，预览 {previewRows.length} 行
                </Typography.Text>
              }
            />
          ) : null}
          {previewRows.length ? (
            <Table size="small" rowKey={(_, index) => String(index)} columns={columns} dataSource={previewRows} pagination={false} />
          ) : null}
        </Space>
      </Card>
      <Card className="table-card">
        <div className="table-toolbar">
          <div className="left">
            <Button icon={<DownloadOutlined />} onClick={exportMolecules}>
              导出分子库 CSV
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportDescriptors}>
              导出描述符矩阵 CSV
            </Button>
          </div>
          <div className="right">
            <Checkbox checked={numericOnly} onChange={(event) => setNumericOnly(event.target.checked)}>
              仅数值
            </Checkbox>
          </div>
        </div>
      </Card>
    </div>
  );
}
