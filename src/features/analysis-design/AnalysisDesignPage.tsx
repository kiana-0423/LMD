import { Alert, Button, Card, Empty, Pagination, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAsyncResource } from "../../lib/useAsyncResource";
import EChart from "../../components/EChart";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import PagedContent from "../../components/PagedContent";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { describeMessage, translateMessage, translateMessages } from "../../lib/backendMessages";
import { describeBackendError } from "../../lib/backendErrors";
import {
  comparePerformanceByGroup,
  getConcentrationPerformance,
  getDescriptorPropertyCorrelation,
  getPerformanceDistribution,
  listPerformanceMetrics,
  type AnalysisResult,
  type CorrelationRow,
  type GroupSummary
} from "../../lib/api";

type Metric = { column: string; labelCode?: string; label: string; unit: string };

/** Grouping choices, as keys: the labels are resolved when the component renders, so switching
 *  language re-labels them instead of keeping whatever was current at module load. */
const COMPARISON_GROUPS: { value: string; key: MessageKey }[] = [
  { value: "additive", key: "ui.additive" },
  { value: "base_oil", key: "ui.baseOil" },
  { value: "formulation", key: "ui.formulation" },
  { value: "test_type", key: "ui.testType" }
];

/** Shared framing for every panel: metadata is always shown, even when there is no chart. */
function AnalysisPanel<T>({
  result,
  loading,
  error,
  onRetry,
  children
}: {
  result?: AnalysisResult<T>;
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  children: (result: AnalysisResult<T>) => React.ReactNode;
}) {
  const { t } = useLanguage();
  if (loading) return <LoadingBlock />;
  if (error) {
    const described = describeBackendError(error, t);
    return (
      <PagedContent><Alert
        type="error"
        showIcon
        message={t("ui.analysisFailed")}
        description={
          <Space direction="vertical" size={4}>
            <span>{described.summary}</span>
            <span translate="no">{described.detail}</span>
          </Space>
        }
        action={<Button onClick={onRetry}>{t("ui.retry")}</Button>}
      /></PagedContent>
    );
  }
  if (!result) return <Empty description={t("ui.noAnalysisHasBeenRunYet")} />;
  const evidence = <aside className="analysis-evidence"><PagedContent>
    {translateMessages(result.warnings, t).map((warning) => (
      <Alert key={warning} type="warning" showIcon message={warning} />
    ))}
    <AnalysisMetadataCard result={result} />
  </PagedContent></aside>;
  if (result.status === "insufficient_data") {
    // The backend says how much data it needed and how much it found. That sentence is assembled
    // here, from a code and its counts, rather than arriving pre-written in English.
    const explained = describeMessage(result.message, t);
    return (
      <div className="analysis-result-layout">
        <div className="analysis-visual"><PagedContent>
        <Alert
          type="info"
          showIcon
          message={t("ui.notEnoughDataYet")}
          description={
            <Space direction="vertical" size={4}>
              <span>{explained.text || t("ui.theWorkspaceDoesNotContainEnoughQualifyingRe")}</span>
              {explained.detail ? (
                <Typography.Text type="secondary">
                  {t("ui.diagnosticDetail")}: <span translate="no">{explained.detail}</span>
                </Typography.Text>
              ) : null}
            </Space>
          }
        />
        </PagedContent></div>
        {evidence}
      </div>
    );
  }
  return (
    <div className="analysis-result-layout">
      <div className="analysis-visual">{children(result)}</div>
      {evidence}
    </div>
  );
}

function AnalysisMetadataCard<T>({ result }: { result: AnalysisResult<T> }) {
  const { t } = useLanguage();
  const { metadata } = result;
  // `field` and `unit` are the stored column name and the recorded unit: the user's own data, and
  // the same in every language. The method and the missing-value rule are prose, and are not.
  return (
    <Card size="small" title={t("ui.howThisWasCalculated")}>
      <Space size={16} wrap>
        <Statistic title={t("ui.recordsUsed")} value={metadata.recordCount} />
        <Statistic title={t("ui.recordsExcluded")} value={metadata.excludedCount} />
        <div>
          <Typography.Text type="secondary">{t("ui.field")}</Typography.Text>
          <div translate="no">{metadata.field}</div>
        </div>
        <div>
          <Typography.Text type="secondary">{t("ui.unit")}</Typography.Text>
          <div translate="no">{metadata.unit || "-"}</div>
        </div>
      </Space>
      {/* Each line is one text node rather than a label beside an expression: a sentence split
          across nodes reads the same but cannot be found, quoted, or selected as one thing. */}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {`${t("ui.howThisWasCalculatedMethod")}: ${translateMessage(metadata.methodMessage, t)}`}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {`${t("ui.missingValues")}: ${translateMessage(metadata.missingValueMessage, t)}`}
      </Typography.Paragraph>
    </Card>
  );
}

export default function AnalysisDesignPage() {
  const { t } = useLanguage();
  const [metric, setMetric] = useState("average_friction_coefficient");
  const [group, setGroup] = useState("additive");

  /**
   * The metric list, and the four analyses for the selected metric.
   *
   * Both go through the shared resource hook: it carries the loading and error states these panels
   * render, discards a response that arrives after a newer one — changing the metric twice quickly
   * produces exactly that — and gives the failure a retry rather than an empty chart.
   *
   * The metric list used to swallow its own failure with `.catch(() => setMetrics([]))`, which made
   * a backend that was not answering look like a workspace with no metrics.
   */
  const metricsResource = useAsyncResource(() => listPerformanceMetrics(), []);
  // Memoised so the fallback array is not a new value on every render, which would make the
  // option list below rebuild continuously.
  const metrics = useMemo<Metric[]>(() => metricsResource.data ?? [], [metricsResource.data]);

  // A group change only refreshes the comparison. One failed analysis does not hide the others.
  const distributionResource = useAsyncResource(() => getPerformanceDistribution(metric), [metric]);
  const comparisonResource = useAsyncResource(() => comparePerformanceByGroup(group, metric), [group, metric]);
  const concentrationResource = useAsyncResource(() => getConcentrationPerformance(metric), [metric]);
  const correlationResource = useAsyncResource(() => getDescriptorPropertyCorrelation(metric), [metric]);
  const [activeTab, setActiveTab] = useState("distribution");

  function refresh() {
    metricsResource.reload();
    distributionResource.reload();
    comparisonResource.reload();
    concentrationResource.reload();
    correlationResource.reload();
  }

  const selectMetric = setMetric;
  const selectGroup = setGroup;

  const metricOptions = useMemo(
    () =>
      (metrics.length
        ? metrics
        : [
            {
              column: "average_friction_coefficient",
              labelCode: "metric.averageFrictionCoefficient",
              label: t("ui.averageFrictionCoefficient2"),
              unit: ""
            }
          ]
      ).map((item) => ({
        value: item.column,
        // The backend names the metric with a key; the wording is this catalogue's.
        label: item.labelCode ? t(item.labelCode as MessageKey) : item.label
      })),
    // `t` changes with the language, so the options re-label when the language does.
    [metrics, t]
  );

  const correlationColumns: ColumnsType<CorrelationRow> = [
    { title: t("ui.descriptor"), dataIndex: "descriptor", ellipsis: true, render: (value) => <span translate="no">{value}</span> },
    { title: t("ui.samples"), dataIndex: "sampleCount", width: 70 },
    {
      title: t("ui.pearson"),
      dataIndex: "pearson",
      width: 86,
      render: (value: number) => <Tag color={Math.abs(value) >= 0.5 ? "green" : "default"}>{value.toFixed(4)}</Tag>
    },
    {
      title: t("ui.spearman"),
      dataIndex: "spearman",
      width: 86,
      render: (value: number | null) => (value === null ? "-" : value.toFixed(4))
    }
  ];

  return (
    <div className="page-grid analysis-page">
      <PageHeader title={t("ui.analysis")} description={t("ui.distributionsGroupComparisonsConcentrationTr")} />
      <Card className="analysis-toolbar-card">
        <div className="analysis-toolbar">
          <Select
            className="analysis-metric-select"
            loading={metricsResource.loading}
            value={metric}
            options={metricOptions}
            onChange={selectMetric}
            aria-label={t("ui.performanceMetric")}
          />
          {activeTab === "comparison" && <Select
            className="analysis-group-select"
            value={group}
            options={COMPARISON_GROUPS.map((item) => ({ value: item.value, label: t(item.key) }))}
            onChange={selectGroup}
            aria-label={t("ui.comparisonGroup")}
          />}
          <Button onClick={refresh}>{t("analysis.refresh")}</Button>
          {metricsResource.error ? <Alert type="error" showIcon message={describeBackendError(metricsResource.error, t).summary} action={<Button size="small" onClick={metricsResource.reload}>{t("ui.retry")}</Button>} /> : null}
        </div>
      </Card>
      <Card className="analysis-results-card">
        <Tabs activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: "distribution",
              label: t("ui.distribution"),
              children: (
                <AnalysisPanel result={distributionResource.data} loading={distributionResource.loading} error={distributionResource.error} onRetry={distributionResource.reload}>
                  {(result) => (
                    <EChart
                      height="100%"
                      ariaLabel={t("ui.distributionHistogram")}
                      option={{
                        grid: { top: 30, right: 18, bottom: 36, left: 12, containLabel: true },
                        tooltip: { trigger: "axis" },
                        xAxis: { type: "category", data: result.series.map((bin) => bin.label) },
                        yAxis: { type: "value", name: t("ui.records") },
                        series: [{ type: "bar", data: result.series.map((bin) => bin.count) }]
                      }}
                    />
                  )}
                </AnalysisPanel>
              )
            },
            {
              key: "comparison",
              label: t("ui.comparison"),
              children: (
                <AnalysisPanel result={comparisonResource.data} loading={comparisonResource.loading} error={comparisonResource.error} onRetry={comparisonResource.reload}>
                  {(result) => (
                    <GroupComparison key={`${metric}:${group}`} result={result} />
                  )}
                </AnalysisPanel>
              )
            },
            {
              key: "concentration",
              label: t("ui.concentration"),
              children: (
                <AnalysisPanel result={concentrationResource.data} loading={concentrationResource.loading} error={concentrationResource.error} onRetry={concentrationResource.reload}>
                  {(result) => (
                    <div className="analysis-concentration">
                      <Space className="analysis-coefficients" size={16} wrap>
                        <Statistic
                          title={t("ui.pearson")}
                          value={typeof result.pearson === "number" ? result.pearson.toFixed(4) : "-"}
                        />
                        <Statistic
                          title={t("ui.spearman")}
                          value={typeof result.spearman === "number" ? result.spearman.toFixed(4) : "-"}
                        />
                      </Space>
                      <EChart
                        height="100%"
                        ariaLabel={t("ui.concentrationScatter")}
                        option={{
                          grid: { top: 30, right: 30, bottom: 30, left: 12, containLabel: true },
                          tooltip: { trigger: "item" },
                          xAxis: { type: "value", name: t("ui.concentration") },
                          yAxis: { type: "value", name: result.metadata.unit },
                          series: [
                            {
                              type: "scatter",
                              data: result.series.map((point) => [point.concentration, point.value])
                            }
                          ]
                        }}
                      />
                    </div>
                  )}
                </AnalysisPanel>
              )
            },
            {
              key: "correlation",
              label: t("ui.descriptorCorrelation"),
              children: (
                <AnalysisPanel result={correlationResource.data} loading={correlationResource.loading} error={correlationResource.error} onRetry={correlationResource.reload}>
                  {(result) => (
                    <CorrelationTable key={metric} rows={result.series} columns={correlationColumns} />
                  )}
                </AnalysisPanel>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}

function GroupComparison({ result }: { result: AnalysisResult<GroupSummary> }) {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const current = Math.min(page, Math.max(1, Math.ceil(result.series.length / pageSize)));
  const groups = result.series.slice((current - 1) * pageSize, current * pageSize);
  return <div className="analysis-group-chart">
    <EChart height="100%" ariaLabel={t("ui.groupComparisonChart")} option={{
      grid: { top: 30, right: 18, bottom: 40, left: 12, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: groups.map((item) => item.label), axisLabel: { rotate: 25, width: 90, overflow: "truncate" } },
      yAxis: { type: "value", name: result.metadata.unit },
      series: [{ type: "bar", name: t("ui.mean"), data: groups.map((item) => Number(item.summary.mean.toFixed(6))) }]
    }} />
    <Pagination simple hideOnSinglePage current={current} pageSize={pageSize} total={result.series.length} onChange={setPage} showSizeChanger={false} />
  </div>;
}

function CorrelationTable({ rows, columns }: { rows: CorrelationRow[]; columns: ColumnsType<CorrelationRow> }) {
  const container = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      if (node.clientHeight > 0) setPageSize(Math.max(1, Math.min(25, Math.floor((node.clientHeight - 86) / 38))));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <div ref={container} className="analysis-correlation-table">
    <Table size="small" rowKey="descriptor" tableLayout="fixed" columns={columns} dataSource={rows}
      pagination={{ current: Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize))), pageSize, onChange: setPage, showSizeChanger: false, simple: true, hideOnSinglePage: true }}
    />
  </div>;
}
