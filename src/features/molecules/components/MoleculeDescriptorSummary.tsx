import { Button, Card, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { descriptorStatusLabels } from "../../../lib/constants";
import type { Molecule } from "../../../types";

export default function MoleculeDescriptorSummary({ molecule }: { molecule: Molecule }) {
  const navigate = useNavigate();

  return (
    <Card size="small" title="描述符摘要">
      <Space direction="vertical" size={12}>
        <Space wrap>
          <Tag color={molecule.descriptorReady ? "green" : "red"}>
            {molecule.descriptorReady ? "描述符就绪" : "描述符未就绪"}
          </Tag>
          <Tag>RDKit: {descriptorStatusLabels[molecule.rdkitDescriptorStatus] ?? molecule.rdkitDescriptorStatus}</Tag>
          <Tag>Mordred: {descriptorStatusLabels[molecule.mordredDescriptorStatus] ?? molecule.mordredDescriptorStatus}</Tag>
        </Space>
        <Typography.Text type="secondary">
          完整 RDKit 与 Mordred 描述符请在描述符中心查看。
        </Typography.Text>
        <Button type="primary" onClick={() => navigate("/descriptors")}>
          前往描述符中心
        </Button>
      </Space>
    </Card>
  );
}
