import { Card, Empty, Tag } from "antd";
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatCard from "../../components/StatCard";
import { getDashboardSummary, listMolecules } from "../../lib/api";
import type { DashboardSummary, Molecule } from "../../types";

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [molecules, setMolecules] = useState<Molecule[]>([]);

  useEffect(() => {
    getDashboardSummary().then(setSummary);
    listMolecules().then(setMolecules);
  }, []);

  const tableSummary = [
    { label: "分子", value: summary?.moleculeCount ?? 0 },
    { label: "基础油", value: summary?.baseOilCount ?? 0 },
    { label: "添加剂", value: summary?.additiveCount ?? 0 },
    { label: "配方", value: summary?.formulationCount ?? 0 },
    { label: "配方组分", value: summary?.formulationComponentCount ?? 0 },
    { label: "实验", value: summary?.experimentCount ?? 0 },
    { label: "性能结果", value: summary?.performanceResultCount ?? 0 },
    { label: "附件", value: summary?.attachmentCount ?? 0 },
    { label: "数据来源", value: summary?.dataSourceCount ?? 0 }
  ];

  const descriptorSummary = [
    { label: "描述符记录", value: summary?.descriptorRecordCount ?? 0, color: "blue" },
    { label: "分子就绪", value: summary?.descriptorReadyCount ?? 0, color: "green" },
    { label: "真实计算", value: summary?.descriptorRealCount ?? 0, color: "cyan" },
    { label: "模拟记录", value: summary?.descriptorMockCount ?? 0, color: "gold" },
    { label: "待处理", value: summary?.descriptorPendingCount ?? 0, color: "orange" },
    { label: "失败", value: summary?.descriptorFailedCount ?? 0, color: "red" }
  ];

  return (
    <div className="page-grid dashboard-page">
      <PageHeader
        title="仪表盘"
        description="从本地 SQLite 工作区实时汇总分子、描述符、配方、实验和文件记录。"
      />
      <div className="stats-grid">
        <StatCard title="分子" value={summary?.moleculeCount ?? 0} />
        <StatCard title="基础油" value={summary?.baseOilCount ?? 0} />
        <StatCard title="添加剂" value={summary?.additiveCount ?? 0} />
        <StatCard title="配方" value={summary?.formulationCount ?? 0} />
        <StatCard title="实验" value={summary?.experimentCount ?? 0} />
        <StatCard title="描述符就绪" value={summary?.descriptorReadyCount ?? 0} />
        <StatCard title="描述符失败" value={summary?.descriptorFailedCount ?? 0} />
        <StatCard title="描述符记录" value={summary?.descriptorRecordCount ?? 0} />
      </div>
      <div className="two-column-grid">
        <Card size="small" title="数据库表记录">
          <div className="dashboard-summary-grid">
            {tableSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.value > 0 ? "blue" : "default"} />
            ))}
          </div>
        </Card>
        <Card size="small" title="描述符状态">
          <div className="dashboard-summary-grid">
            {descriptorSummary.map((item) => (
              <MetricRow key={item.label} label={item.label} value={item.value} color={item.color} />
            ))}
          </div>
        </Card>
        <Card size="small" title="描述符健康状态">
          {molecules.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="数据库中暂无分子记录。" />
          ) : (
            <div className="dashboard-molecule-grid">
              {molecules.slice(0, 8).map((item) => (
                <div className="dashboard-molecule-row" key={item.id}>
                  <div>
                    <div className="dashboard-row-label">{item.name}</div>
                    <div className="dashboard-row-subtitle">{item.smilesCanonical}</div>
                  </div>
                  <Tag color={item.descriptorReady ? "green" : "red"}>{item.descriptorReady ? "就绪" : "需处理"}</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card size="small" title="任务状态">
          <div className="dashboard-summary-grid dashboard-summary-grid-single">
            <MetricRow label="任务总数" value={summary?.jobCount ?? 0} />
            <MetricRow label="进行中或等待" value={summary?.runningJobCount ?? 0} />
            <MetricRow label="失败任务" value={summary?.failedJobCount ?? 0} color="red" />
            <MetricRow label="附件记录" value={summary?.attachmentCount ?? 0} />
          </div>
        </Card>
      </div>
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
