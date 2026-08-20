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
          { key: "overview", label: "Overview", children: <MoleculePropertyPanel molecule={molecule} /> },
          { key: "2d", label: "2D Structure", children: <MoleculeViewer2D molecule={molecule} /> },
          { key: "3d", label: "3D Structure", children: <MoleculeViewer3D molecule={molecule} /> },
          {
            key: "descriptors",
            label: "Descriptor Summary",
            children: <MoleculeDescriptorSummary molecule={molecule} />
          },
          { key: "formulations", label: "Related Formulations", children: <FormulationUsageTable /> },
          { key: "notes", label: "Notes", children: <MoleculeDesignNotesPanel molecule={molecule} /> }
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
      role: "Additive",
      concentration: "1.0 wt%",
      experiments: 2,
      performance: "Best friction coefficient: 0.082"
    }
  ];
  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: "Formulation", dataIndex: "formulation" },
    { title: "Role", dataIndex: "role", render: (value) => <Tag>{value}</Tag> },
    { title: "Concentration", dataIndex: "concentration" },
    { title: "Related Experiments", dataIndex: "experiments" },
    { title: "Performance Summary", dataIndex: "performance" }
  ];
  return <Table size="small" columns={columns} dataSource={rows} pagination={false} />;
}
