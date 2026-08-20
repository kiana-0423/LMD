import { Button, Card, Empty, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getDashboardSummary, listMolecules } from "../../lib/api";
import type { DashboardSummary, Molecule } from "../../types";

export default function DashboardPage() {
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
      const [nextSummary, nextMolecules] = await Promise.all([getDashboardSummary(), listMolecules()]);
      setSummary(nextSummary);
      setMolecules(nextMolecules);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const tableSummary = [
    { label: "Molecules", value: summary?.moleculeCount ?? 0 },
    { label: "Base Oils", value: summary?.baseOilCount ?? 0 },
    { label: "Additives", value: summary?.additiveCount ?? 0 },
    { label: "Formulations", value: summary?.formulationCount ?? 0 },
    { label: "Formulation Components", value: summary?.formulationComponentCount ?? 0 },
    { label: "Experiments", value: summary?.experimentCount ?? 0 },
    { label: "Performance Results", value: summary?.performanceResultCount ?? 0 },
    { label: "Attachments", value: summary?.attachmentCount ?? 0 },
    { label: "Data Sources", value: summary?.dataSourceCount ?? 0 }
  ];

  const descriptorSummary = [
    { label: "Descriptor Records", value: summary?.descriptorRecordCount ?? 0, color: "blue" },
    { label: "Molecules Ready", value: summary?.descriptorReadyCount ?? 0, color: "green" },
    { label: "Live Calculations", value: summary?.descriptorRealCount ?? 0, color: "cyan" },
    { label: "Mock Records", value: summary?.descriptorMockCount ?? 0, color: "gold" },
    { label: "Pending", value: summary?.descriptorPendingCount ?? 0, color: "orange" },
    { label: "Failed", value: summary?.descriptorFailedCount ?? 0, color: "red" }
  ];

  return (
    <div className="page-grid dashboard-page">
      <PageHeader
        title="Dashboard"
        description="Live summary of molecules, descriptors, formulations, experiments, and files in the local SQLite workspace."
      />
      {loading ? <LoadingBlock /> : null}
      {!loading && errorText ? (
        <Card className="error-panel">
          <Typography.Title level={4}>Failed to load the dashboard</Typography.Title>
          <Typography.Paragraph>{errorText}</Typography.Paragraph>
          <Button type="primary" onClick={loadDashboard}>
            Retry
          </Button>
        </Card>
      ) : null}
      {!loading && !errorText ? (
        <>
      <div className="stats-grid">
        <StatCard title="Molecules" value={summary?.moleculeCount ?? 0} />
        <StatCard title="Base Oils" value={summary?.baseOilCount ?? 0} />
        <StatCard title="Additives" value={summary?.additiveCount ?? 0} />
        <StatCard title="Formulations" value={summary?.formulationCount ?? 0} />
        <StatCard title="Experiments" value={summary?.experimentCount ?? 0} />
        <StatCard title="Descriptors Ready" value={summary?.descriptorReadyCount ?? 0} />
        <StatCard title="Descriptor Failures" value={summary?.descriptorFailedCount ?? 0} />
        <StatCard title="Descriptor Records" value={summary?.descriptorRecordCount ?? 0} />
      </div>
      <div className="two-column-grid">
        <Card size="small" title="Database Records">
          <div className="dashboard-summary-grid">
            {tableSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.value > 0 ? "blue" : "default"} />
            ))}
          </div>
        </Card>
        <Card size="small" title="Descriptor Status">
          <div className="dashboard-summary-grid">
            {descriptorSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.color} />
            ))}
          </div>
        </Card>
        <Card size="small" title="Descriptor Health">
          {molecules.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No molecule records in the database." />
          ) : (
            <div className="dashboard-molecule-grid">
              {molecules.slice(0, 8).map((item) => (
                <div className="dashboard-molecule-row" key={item.id}>
                  <div>
                    <div className="dashboard-row-label">{item.name}</div>
                    <div className="dashboard-row-subtitle">{item.smilesCanonical}</div>
                  </div>
                  <Tag color={item.descriptorReady ? "green" : "red"}>{item.descriptorReady ? "Ready" : "Needs attention"}</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card size="small" title="Job Status">
          <div className="dashboard-summary-grid dashboard-summary-grid-single">
            <MetricRow label="Total Jobs" value={summary?.jobCount ?? 0} />
            <MetricRow label="Running or Waiting" value={summary?.runningJobCount ?? 0} />
            <MetricRow label="Failed Jobs" value={summary?.failedJobCount ?? 0} color="red" />
            <MetricRow label="Attachment Records" value={summary?.attachmentCount ?? 0} />
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
