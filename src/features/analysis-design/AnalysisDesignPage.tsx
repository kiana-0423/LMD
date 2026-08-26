import { Alert, Button, Card, Empty, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAsyncResource } from "../../lib/useAsyncResource";
import EChart from "../../components/EChart";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
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
  type ConcentrationPoint,
  type CorrelationRow,
  type DistributionBin,
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
      <Alert
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
      />
    );
  }
  if (!result) return <Empty description={t("ui.noAnalysisHasBeenRunYet")} />;
  if (result.status === "insufficient_data") {
    // The backend says how much data it needed and how much it found. That sentence is assembled
    // here, from a code and its counts, rather than arriving pre-written in English.
    const explained = describeMessage(result.message, t);
    return (
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
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
        <AnalysisMetadataCard result={result} />
      </Space>
    );
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      {translateMessages(result.warnings, t).map((warning) => (
        <Alert key={warning} type="warning" showIcon message={warning} />
      ))}
      {children(result)}
      <AnalysisMetadataCard result={result} />
    </Space>
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

  const analyses = useAsyncResource(
    () =>
      Promise.all([
        getPerformanceDistribution(metric),
        comparePerformanceByGroup(group, metric),
        getConcentrationPerformance(metric),
        getDescriptorPropertyCorrelation(metric)
      ]),
    [group, metric]
  );

  // Destructured with explicit types: `Promise.all` widens a heterogeneous tuple to `unknown[]`
  // once it passes through the resource's generic.
  const [distribution, comparison, concentration, correlation] = (analyses.data ?? []) as [
    AnalysisResult<DistributionBin> | undefined,
    AnalysisResult<GroupSummary> | undefined,
    AnalysisResult<ConcentrationPoint> | undefined,
    AnalysisResult<CorrelationRow> | undefined
  ];
  const loading = analyses.loading;
  const error = analyses.error;

  function refresh() {
    metricsResource.reload();
    analyses.reload();
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
    { title: t("ui.descriptor"), dataIndex: "descriptor", render: (value) => <span translate="no">{value}</span> },
    { title: t("ui.samples"), dataIndex: "sampleCount", width: 100 },
    {
      title: t("ui.pearson"),
      dataIndex: "pearson",
      width: 140,
      render: (value: number) => <Tag color={Math.abs(value) >= 0.5 ? "green" : "default"}>{value.toFixed(4)}</Tag>
    },
    {
      title: t("ui.spearman"),
      dataIndex: "spearman",
      width: 140,
      render: (value: number | null) => (value === null ? "-" : value.toFixed(4))
    }
  ];

  return (
    <div className="page-grid">
      <PageHeader title={t("ui.analysis")} description={t("ui.distributionsGroupComparisonsConcentrationTr")} />
      <Card>
        <Space size={12} wrap>
          <Select
            style={{ width: 280 }}
            value={metric}
            options={metricOptions}
            onChange={selectMetric}
            aria-label={t("ui.performanceMetric")}
          />
          <Select
            style={{ width: 200 }}
            value={group}
            options={COMPARISON_GROUPS.map((item) => ({ value: item.value, label: t(item.key) }))}
            onChange={selectGroup}
            aria-label={t("ui.comparisonGroup")}
          />
        </Space>
      </Card>
      <Card className="table-card">
        <Tabs
          items={[
            {
              key: "distribution",
              label: t("ui.distribution"),
              children: (
                <AnalysisPanel result={distribution} loading={loading} error={error} onRetry={refresh}>
                  {(result) => (
                    <EChart
                      ariaLabel={t("ui.distributionHistogram")}
                      option={{
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
                <AnalysisPanel result={comparison} loading={loading} error={error} onRetry={refresh}>
                  {(result) => (
                    <EChart
                      ariaLabel={t("ui.groupComparisonChart")}
                      option={{
                        tooltip: { trigger: "axis" },
                        xAxis: {
                          type: "category",
                          data: result.series.map((item) => item.label),
                          axisLabel: { rotate: 30 }
                        },
                        yAxis: { type: "value", name: result.metadata.unit },
                        series: [
                          {
                            type: "bar",
                            name: t("ui.mean"),
                            data: result.series.map((item) => Number(item.summary.mean.toFixed(6)))
                          }
                        ]
                      }}
                    />
                  )}
                </AnalysisPanel>
              )
            },
            {
              key: "concentration",
              label: t("ui.concentration"),
              children: (
                <AnalysisPanel result={concentration} loading={loading} error={error} onRetry={refresh}>
                  {(result) => (
                    <Space direction="vertical" style={{ width: "100%" }} size={12}>
                      <Space size={16} wrap>
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
                        height={320}
                        ariaLabel={t("ui.concentrationScatter")}
                        option={{
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
                    </Space>
                  )}
                </AnalysisPanel>
              )
            },
            {
              key: "correlation",
              label: t("ui.descriptorCorrelation"),
              children: (
                <AnalysisPanel result={correlation} loading={loading} error={error} onRetry={refresh}>
                  {(result) => (
                    <Table
                      size="small"
                      rowKey="descriptor"
                      columns={correlationColumns}
                      dataSource={result.series}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                    />
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
