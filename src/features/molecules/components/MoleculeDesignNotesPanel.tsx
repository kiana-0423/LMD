import { Card, Typography } from "antd";
import type { Molecule } from "../../../types";

export default function MoleculeDesignNotesPanel({ molecule }: { molecule: Molecule }) {
  return (
    <Card size="small" title="分子简介">
      <Typography.Paragraph>{molecule.notes || "暂无分子简介。"}</Typography.Paragraph>
    </Card>
  );
}
