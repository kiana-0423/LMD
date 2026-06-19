import { Button, Card, Checkbox, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import {
  exportAllDescriptorsCsv,
  exportMlDescriptorMatrixCsv,
  listMoleculeDescriptors,
  listMolecules,
  recalculateAllDescriptors
} from "../../lib/api";
import { descriptorStatusLabels } from "../../lib/constants";
import { downloadTextFile } from "../../lib/downloads";
import type { DescriptorStatus, MLDescriptorMatrixOptions, Molecule, MoleculeDescriptor } from "../../types";

type Row = {
  moleculeId: string;
  moleculeName: string;
  rdkitStatus: DescriptorStatus | "missing";
  mordredStatus: DescriptorStatus | "missing";
  descriptorMode: "real" | "mock" | "failed";
  descriptorCount: number;
};

function statusColor(status: string) {
  if (status === "calculated" || status === "real") return "green";
  if (status === "mock") return "gold";
  if (status === "failed") return "red";
  return "blue";
}

export default function DescriptorCenterPage() {
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [descriptors, setDescriptors] = useState<MoleculeDescriptor[]>([]);
  const [numericOnly, setNumericOnly] = useState(true);

  async function refresh() {
    setMolecules(await listMolecules());
    setDescriptors(await listMoleculeDescriptors());
  }

  useEffect(() => {
    refresh();
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      molecules.map((molecule) => {
        const moleculeDescriptors = descriptors.filter((item) => item.moleculeId === molecule.id);
        const rdkit = moleculeDescriptors.find((item) => item.descriptorSet === "rdkit");
        const mordred = moleculeDescriptors.find((item) => item.descriptorSet === "mordred");
        return {
          moleculeId: molecule.id,
          moleculeName: molecule.name,
          rdkitStatus: rdkit?.status ?? "missing",
          mordredStatus: mordred?.status ?? "missing",
          descriptorMode: moleculeDescriptors.some((item) => item.status === "failed")
            ? "failed"
            : moleculeDescriptors.some((item) => item.mode === "mock")
              ? "mock"
              : "real",
          descriptorCount: moleculeDescriptors.reduce((sum, item) => sum + item.descriptorCount, 0)
        };
      }),
    [molecules, descriptors]
  );

  async function downloadCsv(kind: "all" | "ml") {
    const options: MLDescriptorMatrixOptions = {
      includeRdkit: true,
      includeMordred: true,
      numericOnly,
      includeMetadata: true,
      missingValueStrategy: "blank",
      descriptorPrefix: true
    };
    const content = kind === "all" ? await exportAllDescriptorsCsv() : await exportMlDescriptorMatrixCsv(options);
    downloadTextFile(kind === "all" ? "all-descriptors.csv" : "ml-descriptor-matrix.csv", content, "text/csv;charset=utf-8");
    message.success("已从隐藏的 descriptors_json 生成 CSV 导出。");
  }

  const columns: ColumnsType<Row> = [
    { title: "ID", dataIndex: "moleculeId", width: 140 },
    {
      title: "名称类型",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.moleculeName}</span>
          <Tag color={statusColor(row.descriptorMode)}>{descriptorStatusLabels[row.descriptorMode] ?? row.descriptorMode}</Tag>
        </Space>
      )
    },
    {
      title: "描述符状态",
      render: (_, row) => (
        <Space size={6} wrap>
          <Tag color={statusColor(row.rdkitStatus)}>RDKit: {descriptorStatusLabels[row.rdkitStatus] ?? row.rdkitStatus}</Tag>
          <Tag color={statusColor(row.mordredStatus)}>Mordred: {descriptorStatusLabels[row.mordredStatus] ?? row.mordredStatus}</Tag>
          <Tag>{row.descriptorCount}</Tag>
        </Space>
      )
    }
  ];

  return (
    <div className="page-grid table-page">
      <PageHeader
        title="描述符中心"
        description="管理描述符状态；完整 RDKit/Mordred 描述符在详情或 CSV 导出中展开。"
      />
      <Card className="table-card">
        <div className="table-toolbar descriptor-toolbar">
          <div className="left">
            <Button onClick={() => downloadCsv("all")}>导出全部 CSV</Button>
            <Button onClick={() => downloadCsv("ml")}>导出 ML 矩阵</Button>
            <Button onClick={() => message.info("失败描述符的模拟重算任务已加入队列。")}>
              重算失败
            </Button>
            <Button
              type="primary"
              onClick={async () => {
                await recalculateAllDescriptors();
                await refresh();
                message.success("已在模拟模式下重算全部描述符。");
              }}
            >
              重算全部
            </Button>
          </div>
          <div className="right">
            <Checkbox checked={numericOnly} onChange={(event) => setNumericOnly(event.target.checked)}>
              仅数值
            </Checkbox>
          </div>
        </div>
        <Table
          size="small"
          rowKey="moleculeId"
          columns={columns}
          dataSource={rows}
          tableLayout="fixed"
          pagination={{ pageSize: 7, showSizeChanger: false }}
        />
      </Card>
    </div>
  );
}
