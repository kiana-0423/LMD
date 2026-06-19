import { Button, Card, Form, InputNumber, Select, Space, Table, Tag, message } from "antd";
import PageHeader from "../../components/PageHeader";

const descriptorRows = [
  { key: "MolLogP", descriptor: "rdkit_MolLogP", target: "1.8 - 3.4", weight: 0.18 },
  { key: "TPSA", descriptor: "rdkit_TPSA", target: "20 - 75", weight: 0.14 },
  { key: "ABC", descriptor: "mordred_ABC", target: "12 - 26", weight: 0.11 },
  { key: "P", descriptor: "Element_P", target: "允许", weight: 0.09 }
];

const candidateRows = [
  { key: "md-001", molecule: "含磷硫抗磨候选分子", smiles: "CCOP(=S)(OCC)SCC", score: 0.88, status: "待验证" },
  { key: "md-002", molecule: "酯类摩擦改进候选分子", smiles: "CCCCCCCCOC(=O)CCO", score: 0.83, status: "待验证" },
  { key: "md-003", molecule: "含氮抗氧候选分子", smiles: "CCN(CC)CCOc1ccccc1O", score: 0.79, status: "待验证" },
  { key: "md-004", molecule: "硼酸酯候选分子", smiles: "CCCOB(OCCC)OCCC", score: 0.76, status: "待验证" }
];

export default function MoleculeDesignPage() {
  return (
    <div className="page-grid molecule-prediction-page">
      <PageHeader title="分子设计" description="输入预期性能，反推目标描述符空间并生成候选分子。" />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item label="目标摩擦系数">
              <InputNumber min={0} max={1} step={0.001} defaultValue={0.08} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="目标磨斑直径">
              <InputNumber min={0} addonAfter="um" defaultValue={400} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="目标氧化温度">
              <InputNumber min={0} addonAfter="C" defaultValue={260} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="生成策略">
              <Select
                defaultValue="descriptor_inverse"
                options={[
                  { value: "descriptor_inverse", label: "描述符反推" },
                  { value: "similarity_search", label: "相似分子搜索" },
                  { value: "fragment_recombine", label: "片段重组" }
                ]}
              />
            </Form.Item>
            <Form.Item label="设计动作">
              <Button type="primary" block onClick={() => message.success("分子设计任务已创建。")}>
                生成候选
              </Button>
            </Form.Item>
          </div>
        </Form>
      </Card>
      <div className="prediction-result-grid">
        <div className="prediction-left-stack">
          <Card className="table-card">
            <Table
              size="small"
              rowKey="key"
              columns={[
                { title: "目标描述符", dataIndex: "descriptor" },
                { title: "反推范围", dataIndex: "target" },
                { title: "模型权重", dataIndex: "weight" }
              ]}
              dataSource={descriptorRows}
              pagination={false}
            />
          </Card>
          <Card className="table-card">
            <Table
              size="small"
              rowKey="key"
              columns={[
                { title: "候选分子", dataIndex: "molecule" },
                { title: "综合评分", dataIndex: "score" },
                { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
              ]}
              dataSource={candidateRows}
              pagination={false}
            />
          </Card>
        </div>
        <Card
          className="table-card prediction-chart-card"
          title={
            <Space size={10} wrap>
              <span>可能生成的分子 SMILES</span>
              <Tag color="blue">候选 {candidateRows.length}</Tag>
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="key"
            columns={[
              { title: "候选分子", dataIndex: "molecule", width: 180 },
              { title: "SMILES", dataIndex: "smiles", className: "mono" },
              { title: "综合评分", dataIndex: "score", width: 92 },
              { title: "状态", dataIndex: "status", width: 92, render: (value) => <Tag>{value}</Tag> }
            ]}
            dataSource={candidateRows}
            pagination={false}
          />
        </Card>
      </div>
    </div>
  );
}
