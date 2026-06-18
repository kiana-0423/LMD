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
    { key: "source", type: "导入源文件", path: "files/imports/mock-source.csv" },
    { key: "report", type: "报告文件", path: "files/reports/mock-report.pdf" }
  ].filter((item) => item.path);

  const columns: ColumnsType<FileRow> = [
    { title: "类型", dataIndex: "type", render: (value) => <Tag>{value}</Tag> },
    { title: "相对路径", dataIndex: "path" },
    {
      title: "操作",
      render: () => (
        <Button.Group>
          <Button size="small">打开</Button>
          <Button size="small">导出</Button>
          <Button size="small" danger>删除</Button>
        </Button.Group>
      )
    }
  ];

  return <Table size="small" columns={columns} dataSource={rows} pagination={false} />;
}
