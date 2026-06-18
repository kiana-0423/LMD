import { Drawer, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Molecule } from "../../types";
import MoleculeDescriptorSummary from "./components/MoleculeDescriptorSummary";
import MoleculeDesignNotesPanel from "./components/MoleculeDesignNotesPanel";
import MoleculePropertyPanel from "./components/MoleculePropertyPanel";
import MoleculeViewer2D from "./components/MoleculeViewer2D";
import MoleculeViewer3D from "./components/MoleculeViewer3D";

export default function MoleculeDetailDrawer({
  molecule,
  open,
  onClose
}: {
  molecule?: Molecule;
  open: boolean;
  onClose: () => void;
}) {
  if (!molecule) return null;

  return (
    <Drawer width={760} title={molecule.name} open={open} onClose={onClose} destroyOnClose>
      <Tabs
        className="molecule-detail-tabs"
        items={[
          { key: "overview", label: "概览", children: <MoleculePropertyPanel molecule={molecule} /> },
          { key: "2d", label: "2D 结构", children: <MoleculeViewer2D molecule={molecule} /> },
          { key: "3d", label: "3D 结构", children: <MoleculeViewer3D molecule={molecule} /> },
          {
            key: "descriptors",
            label: "描述符摘要",
            children: <MoleculeDescriptorSummary molecule={molecule} />
          },
          { key: "formulations", label: "相关配方", children: <FormulationUsageTable /> },
          { key: "notes", label: "备注", children: <MoleculeDesignNotesPanel molecule={molecule} /> }
        ]}
      />
    </Drawer>
  );
}

function FormulationUsageTable() {
  const rows = [
    {
      key: "usage-1",
      formulation: "PAO-6 + ZDDP 1.0%",
      role: "添加剂",
      concentration: "1.0 wt%",
      experiments: 2,
      performance: "最佳摩擦系数 0.082"
    }
  ];
  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: "配方", dataIndex: "formulation" },
    { title: "角色", dataIndex: "role", render: (value) => <Tag>{value}</Tag> },
    { title: "浓度", dataIndex: "concentration" },
    { title: "关联实验", dataIndex: "experiments" },
    { title: "性能摘要", dataIndex: "performance" }
  ];
  return <Table size="small" columns={columns} dataSource={rows} pagination={false} />;
}
