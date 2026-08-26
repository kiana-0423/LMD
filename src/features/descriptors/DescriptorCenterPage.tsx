import { Button, Card, Checkbox, Empty, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import AsyncBoundary from "../../components/AsyncBoundary";
import { useAsyncResource } from "../../lib/useAsyncResource";
import PageHeader from "../../components/PageHeader";
import {
  deliverExport,
  describeExport,
  exportAllDescriptorsCsv,
  exportMlDescriptorMatrixCsv,
  listDescriptorJobs,
  listDescriptorsForMolecules,
  listMoleculePage,
  recalculateAllDescriptors,
  recalculateFailedDescriptors
} from "../../lib/api";
import { descriptorStatusLabelKeys } from "../../lib/constants";
import type { DescriptorJob, DescriptorStatus, MLDescriptorMatrixOptions, MoleculeDescriptor } from "../../types";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText, describeBackendError } from "../../lib/backendErrors";

const PAGE_SIZE = 7;

type Row = {
  moleculeId: string;
  moleculeName: string;
  rdkitStatus: DescriptorStatus | "missing";
  mordredStatus: DescriptorStatus | "missing";
  descriptorMode: "real" | "mock" | "failed";
  descriptorCount: number;
};

/** A batch that only partly succeeded is neither green nor red. */
function jobStatusColor(status: DescriptorJob["status"]) {
  if (status === "succeeded") return "green";
  if (status === "failed" || status === "interrupted") return "red";
  if (status === "partial") return "gold";
  return "blue";
}

function statusColor(status: string) {
  if (status === "calculated" || status === "real") return "green";
  if (status === "mock") return "gold";
  if (status === "failed") return "red";
  return "blue";
}

export default function DescriptorCenterPage() {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [numericOnly, setNumericOnly] = useState(true);
  /**
   * One page of molecules with the descriptor status of each.
   *
   * Two queries, whatever the page size. It used to be one call per molecule — twenty-five IPC
   * round trips to render one page — and the whole thing ran inside a `try/finally` with no
   * `catch`, so a backend failure became an unhandled rejection and an empty table that looked
   * exactly like a workspace with no molecules.
   */
  const data = useAsyncResource(async () => {
    const [molecules, history] = await Promise.all([
      listMoleculePage({ page, pageSize: PAGE_SIZE }),
      listDescriptorJobs(10)
    ]);
    const descriptors = await listDescriptorsForMolecules(molecules.items.map((item) => item.id));
    const byMolecule = new Map<string, MoleculeDescriptor[]>();
    for (const record of descriptors) {
      byMolecule.set(record.moleculeId, [...(byMolecule.get(record.moleculeId) ?? []), record]);
    }
    return {
      total: molecules.total,
      jobs: history,
      rows: molecules.items.map((molecule) =>
        toRow(molecule.id, molecule.name, byMolecule.get(molecule.id) ?? [])
      )
    };
  }, [page]);

  const rows = data.data?.rows ?? [];
  const jobs = data.data?.jobs ?? [];
  const total = data.data?.total ?? 0;
  const loading = data.loading;

  async function refresh() {
    data.reload();
  }

  async function runRecalculation(kind: "all" | "failed") {
    setBusy(true);
    try {
      await (kind === "all" ? recalculateAllDescriptors() : recalculateFailedDescriptors());
      await refresh();
      message.success(kind === "all" ? t("ui.allDescriptorsRecalculated"): t("ui.failedDescriptorsRecalculated"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv(kind: "all" | "ml") {
    const options: MLDescriptorMatrixOptions = {
      includeRdkit: true,
      includeMordred: true,
      numericOnly,
      includeMetadata: true,
      missingValueStrategy: "blank",
      descriptorPrefix: true
    };
    const result = kind === "all" ? await exportAllDescriptorsCsv() : await exportMlDescriptorMatrixCsv(options);
    deliverExport(result);
    message.success(
      describeExport(result, kind === "all" ? t("ui.allDescriptors") : t("ui.mlDescriptorMatrix"), { savedTo: t("ui.exportedRowsTo"), exported: t("ui.exportedShort") })
    );
  }

  const columns = useMemo<ColumnsType<Row>>(
    () => [
      { title: "ID", dataIndex: "moleculeId", width: 140 },
      {
        title: t("ui.nameType"),
        render: (_, row) => (
          <Space size={6} wrap>
            <span translate="no">{row.moleculeName}</span>
            <Tag color={statusColor(row.descriptorMode)}>
              {t(descriptorStatusLabelKeys[row.descriptorMode] ?? "label.missing")}
            </Tag>
          </Space>
        )
      },
      {
        title: t("ui.descriptorStatus"),
        render: (_, row) => (
          <Space size={6} wrap>
            <Tag color={statusColor(row.rdkitStatus)}>
              {`RDKit: ${t(descriptorStatusLabelKeys[row.rdkitStatus] ?? "label.missing")}`}
            </Tag>
            <Tag color={statusColor(row.mordredStatus)}>
              {`Mordred: ${t(descriptorStatusLabelKeys[row.mordredStatus] ?? "label.missing")}`}
            </Tag>
            <Tag>{row.descriptorCount}</Tag>
          </Space>
        )
      }
    ],
    // The column headings are translated, so they are rebuilt when the language changes.
    [t]
  );

  return (
    <div className="page-grid table-page">
      <PageHeader
        title={t("ui.descriptorCenter")}
        description={t("ui.manageDescriptorStatusCompleteRdkitAndMordre")}
      />
      <Card className="table-card">
        <div className="table-toolbar descriptor-toolbar">
          <div className="left">
            <Button onClick={() => downloadCsv("all")}>{t("ui.exportAllCsv")}</Button>
            <Button onClick={() => downloadCsv("ml")}>{t("ui.exportMlMatrix")}</Button>
            <Button loading={busy} onClick={() => runRecalculation("failed")}>{t("ui.recalculateFailed")}</Button>
            <Button type="primary" loading={busy} onClick={() => runRecalculation("all")}>{t("ui.recalculateAll")}</Button>
          </div>
          <div className="right">
            <Checkbox checked={numericOnly} onChange={(event) => setNumericOnly(event.target.checked)}>{t("ui.numericOnly")}</Checkbox>
          </div>
        </div>
        <AsyncBoundary
          loading={loading && !data.data}
          error={data.error}
          onRetry={data.reload}
        >
        <Table
          size="small"
          rowKey="moleculeId"
          columns={columns}
          dataSource={rows}
          loading={loading}
          tableLayout="fixed"
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            onChange: setPage
          }}
        />
        </AsyncBoundary>
      </Card>
      <Card className="table-card" title={t("ui.descriptorJobHistory")}>
        {jobs.length === 0 ? (
          <Empty description={t("ui.noDescriptorBatchHasBeenRunInThis")} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={jobs}
            pagination={false}
            columns={[
              { title: t("ui.started"), dataIndex: "createdAt", width: 210 },
              {
                title: t("ui.status"),
                dataIndex: "status",
                width: 130,
                render: (value: DescriptorJob["status"]) => (
                  <Tag color={jobStatusColor(value)}>
                    {t(descriptorStatusLabelKeys[value] ?? "label.missing")}
                  </Tag>
                )
              },
              { title: t("ui.total"), dataIndex: "totalCount", width: 90 },
              { title: t("ui.calculated"), dataIndex: "successCount", width: 110 },
              { title: t("ui.failed"), dataIndex: "failedCount", width: 90 },
              {
                title: t("ui.detail"),
                dataIndex: "errorMessage",
                // A job's failure is a backend message: it carries a code naming the situation and
                // English prose carrying the specifics. Rendering the raw string put
                // "[model.notEnoughData] Training ... needs at least 12 rows" on screen, brackets
                // and all, in every language.
                render: (value: string) => {
                  if (!value) return <span>-</span>;
                  const { summary, detail } = describeBackendError(value, t);
                  return (
                    <Space direction="vertical" size={0}>
                      <span>{summary}</span>
                      {detail ? (
                        <Typography.Text type="secondary">
                          <span translate="no">{detail}</span>
                        </Typography.Text>
                      ) : null}
                    </Space>
                  );
                }
              }
            ]}
          />
        )}
      </Card>
    </div>
  );
}

function toRow(moleculeId: string, moleculeName: string, descriptors: MoleculeDescriptor[]): Row {
  const rdkit = descriptors.find((item) => item.descriptorSet === "rdkit");
  const mordred = descriptors.find((item) => item.descriptorSet === "mordred");
  return {
    moleculeId,
    moleculeName,
    rdkitStatus: rdkit?.status ?? "missing",
    mordredStatus: mordred?.status ?? "missing",
    descriptorMode: descriptors.some((item) => item.status === "failed")
      ? "failed"
      : descriptors.some((item) => item.mode === "mock")
        ? "mock"
        : "real",
    descriptorCount: descriptors.reduce((sum, item) => sum + item.descriptorCount, 0)
  };
}
