import { Button, Card, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { descriptorStatusLabels } from "../../../lib/constants";
import type { Molecule } from "../../../types";

export default function MoleculeDescriptorSummary({ molecule }: { molecule: Molecule }) {
  const navigate = useNavigate();

  return (
    <Card size="small" title="Descriptor Summary">
      <Space direction="vertical" size={12}>
        <Space wrap>
          <Tag color={molecule.descriptorReady ? "green" : "red"}>
            {molecule.descriptorReady ? "Descriptors ready" : "Descriptors not ready"}
          </Tag>
          <Tag>RDKit: {descriptorStatusLabels[molecule.rdkitDescriptorStatus] ?? molecule.rdkitDescriptorStatus}</Tag>
          <Tag>Mordred: {descriptorStatusLabels[molecule.mordredDescriptorStatus] ?? molecule.mordredDescriptorStatus}</Tag>
        </Space>
        <Typography.Text type="secondary">
          View the complete RDKit and Mordred descriptors in the Descriptor Center.
        </Typography.Text>
        <Button type="primary" onClick={() => navigate("/descriptors")}>
          Open Descriptor Center
        </Button>
      </Space>
    </Card>
  );
}
