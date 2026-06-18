import { Card, List, Tag } from "antd";
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

  return (
    <div className="page-grid dashboard-page">
      <PageHeader
        title="仪表盘"
        description="本地分子、描述符、配方、实验和智能设计准备状态总览。"
      />
      <div className="stats-grid">
        <StatCard title="分子" value={summary?.moleculeCount ?? 0} />
        <StatCard title="基础油" value={summary?.baseOilCount ?? 0} />
        <StatCard title="添加剂" value={summary?.additiveCount ?? 0} />
        <StatCard title="配方" value={summary?.formulationCount ?? 0} />
        <StatCard title="实验" value={summary?.experimentCount ?? 0} />
        <StatCard title="描述符就绪" value={summary?.descriptorReadyCount ?? 0} />
        <StatCard title="描述符失败" value={summary?.descriptorFailedCount ?? 0} />
        <StatCard title="Python Sidecar" value="模拟" />
      </div>
      <div className="two-column-grid">
        <Card title="描述符健康状态">
          <List
            dataSource={molecules}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta title={item.name} description={item.smilesCanonical} />
                <Tag color={item.descriptorReady ? "green" : "red"}>{item.descriptorReady ? "就绪" : "需处理"}</Tag>
              </List.Item>
            )}
          />
        </Card>
        <Card title="MVP 范围">
          <List
            dataSource={[
              "九个正式页面均已可用。",
              "分子可视化集成在分子库详情抽屉中。",
              "Mordred 按强制功能建模；模拟描述符会明确标记。",
              "完整描述符默认不在普通表格中展示，可在详情 JSON 或 CSV 导出中展开。"
            ]}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
        </Card>
      </div>
    </div>
  );
}
