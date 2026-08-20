import { Button, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Molecule } from "../../../types";

type FileRow = {
  key: string;
  type: string;
  path: string;
};

export default function MoleculeFilesPanel({ molecule }: { molecule: Molecule }) {
  const rows: FileRow[] = [
    { key: "svg", type: "SVG", path: molecule.structureSvgPath },
    { key: "mol", type: "MOL", path: molecule.molFilePath },
    { key: "sdf", type: "SDF", path: molecule.sdfFilePath },
    { key: "pdb", type: "PDB", path: molecule.pdbFilePath },
    { key: "source", type: "Import source", path: "files/imports/mock-source.csv" },
    { key: "report", type: "Report", path: "files/reports/mock-report.pdf" }
  ].filter((item) => item.path);

  const columns: ColumnsType<FileRow> = [
    { title: "Type", dataIndex: "type", render: (value) => <Tag>{value}</Tag> },
    { title: "Relative Path", dataIndex: "path" },
    {
      title: "Actions",
      render: () => (
        <Button.Group>
          <Button size="small">Open</Button>
          <Button size="small">Export</Button>
          <Button size="small" danger>Delete</Button>
        </Button.Group>
      )
    }
  ];

  return <Table size="small" columns={columns} dataSource={rows} pagination={false} />;
}
