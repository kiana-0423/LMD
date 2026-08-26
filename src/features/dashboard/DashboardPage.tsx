import { Button, Card, Empty, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getDashboardSummary, listMoleculePage } from "../../lib/api";
import type { DashboardSummary, Molecule } from "../../types";
import { useLanguage } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";

const RECENT_MOLECULE_COUNT = 8;

export default function DashboardPage() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setErrorText("");
    try {
      // Only the rows this card renders — the full library is never needed here.
      const [nextSummary, nextMolecules] = await Promise.all([
        getDashboardSummary(),
        listMoleculePage({ page: 1, pageSize: RECENT_MOLECULE_COUNT })
      ]);
      setSummary(nextSummary);
      setMolecules(nextMolecules.items);
    } catch (error) {
      // Stored raw and translated at render, so a switch of language re-reads it.
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const tableSummary = [
    { label: t("ui.molecules"), value: summary?.moleculeCount ?? 0 },
    { label: t("ui.baseOils"), value: summary?.baseOilCount ?? 0 },
    { label: t("ui.additives"), value: summary?.additiveCount ?? 0 },
    { label: t("ui.formulations"), value: summary?.formulationCount ?? 0 },
    { label: t("ui.formulationComponents"), value: summary?.formulationComponentCount ?? 0 },
    { label: t("ui.experiments"), value: summary?.experimentCount ?? 0 },
    { label: t("ui.performanceResults"), value: summary?.performanceResultCount ?? 0 },
    { label: t("ui.attachments"), value: summary?.attachmentCount ?? 0 },
    { label: t("ui.dataSources"), value: summary?.dataSourceCount ?? 0 }
  ];

  const descriptorSummary = [
    { label: t("ui.descriptorRecords"), value: summary?.descriptorRecordCount ?? 0, color: "blue" },
    { label: t("ui.moleculesReady"), value: summary?.descriptorReadyCount ?? 0, color: "green" },
    { label: t("ui.liveCalculations"), value: summary?.descriptorRealCount ?? 0, color: "cyan" },
    { label: t("ui.mockRecords"), value: summary?.descriptorMockCount ?? 0, color: "gold" },
    { label: t("ui.pending"), value: summary?.descriptorPendingCount ?? 0, color: "orange" },
    { label: t("ui.failed"), value: summary?.descriptorFailedCount ?? 0, color: "red" }
  ];

  return (
    <div className="page-grid dashboard-page">
      <PageHeader
        title={t("ui.dashboard")}
        description={t("ui.liveSummaryOfMoleculesDescriptorsFormulation")}
      />
      {loading ? <LoadingBlock /> : null}
      {!loading && errorText ? (
        <Card className="error-panel">
          <Typography.Title level={4}>{t("ui.failedToLoadTheDashboard")}</Typography.Title>
          <Typography.Paragraph>{backendErrorText(errorText, t)}</Typography.Paragraph>
          <Button type="primary" onClick={loadDashboard}>{t("ui.retry")}</Button>
        </Card>
      ) : null}
      {!loading && !errorText ? (
        <>
      <div className="stats-grid">
        <StatCard title={t("ui.molecules")} value={summary?.moleculeCount ?? 0} />
        <StatCard title={t("ui.baseOils")} value={summary?.baseOilCount ?? 0} />
        <StatCard title={t("ui.additives")} value={summary?.additiveCount ?? 0} />
        <StatCard title={t("ui.formulations")} value={summary?.formulationCount ?? 0} />
        <StatCard title={t("ui.experiments")} value={summary?.experimentCount ?? 0} />
        <StatCard title={t("ui.descriptorsReady")} value={summary?.descriptorReadyCount ?? 0} />
        <StatCard title={t("ui.descriptorFailures")} value={summary?.descriptorFailedCount ?? 0} />
        <StatCard title={t("ui.descriptorRecords")} value={summary?.descriptorRecordCount ?? 0} />
      </div>
      <div className="two-column-grid">
        <Card size="small" title={t("ui.databaseRecords")}>
          <div className="dashboard-summary-grid">
            {tableSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.value > 0 ? "blue" : "default"} />
            ))}
          </div>
        </Card>
        <Card size="small" title={t("ui.descriptorStatus")}>
          <div className="dashboard-summary-grid">
            {descriptorSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.color} />
            ))}
          </div>
        </Card>
        <Card size="small" title={t("ui.descriptorHealth")}>
          {molecules.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("ui.noMoleculeRecordsInTheDatabase")} />
          ) : (
            <div className="dashboard-molecule-grid">
              {molecules.map((item) => (
                <div className="dashboard-molecule-row" key={item.id}>
                  <div>
                    <div className="dashboard-row-label" translate="no">{item.name}</div>
                    <div className="dashboard-row-subtitle" translate="no">{item.smilesCanonical}</div>
                  </div>
                  <Tag color={item.descriptorReady ? "green" : "red"}>{item.descriptorReady ? t("ui.ready"): t("ui.needsAttention")}</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card size="small" title={t("ui.jobStatus")}>
          <div className="dashboard-summary-grid dashboard-summary-grid-single">
            <MetricRow label={t("ui.totalJobs")} value={summary?.jobCount ?? 0} />
            <MetricRow label={t("ui.runningOrWaiting")} value={summary?.runningJobCount ?? 0} />
            <MetricRow label={t("ui.failedJobs")} value={summary?.failedJobCount ?? 0} color="red" />
            <MetricRow label={t("ui.attachmentRecords")} value={summary?.attachmentCount ?? 0} />
          </div>
        </Card>
      </div>
        </>
      ) : null}
    </div>
  );
}

function MetricRow({ label, value, color = "default" }: { label: string; value: number; color?: string }) {
  return (
    <div className="dashboard-metric-row">
      <span>{label}</span>
      <Tag color={color}>{value}</Tag>
    </div>
  );
}
