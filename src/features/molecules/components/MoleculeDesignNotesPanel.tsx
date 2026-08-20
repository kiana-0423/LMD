import { Card, Typography } from "antd";
import type { Molecule } from "../../../types";

export default function MoleculeDesignNotesPanel({ molecule }: { molecule: Molecule }) {
  return (
    <Card size="small" title="Molecule Overview">
      <Typography.Paragraph>{molecule.notes || "No molecule overview available."}</Typography.Paragraph>
    </Card>
  );
}
