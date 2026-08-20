import { Button, Card, Form, InputNumber, Select, Space, Table, Tag, message } from "antd";
import PageHeader from "../../components/PageHeader";

const descriptorRows = [
  { key: "MolLogP", descriptor: "rdkit_MolLogP", target: "1.8 - 3.4", weight: 0.18 },
  { key: "TPSA", descriptor: "rdkit_TPSA", target: "20 - 75", weight: 0.14 },
  { key: "ABC", descriptor: "mordred_ABC", target: "12 - 26", weight: 0.11 },
  { key: "P", descriptor: "Element_P", target: "Allowed", weight: 0.09 }
];

const candidateRows = [
  { key: "md-001", molecule: "Phosphorus-sulfur antiwear candidate", smiles: "CCOP(=S)(OCC)SCC", score: 0.88, status: "Pending validation" },
  { key: "md-002", molecule: "Ester friction-modifier candidate", smiles: "CCCCCCCCOC(=O)CCO", score: 0.83, status: "Pending validation" },
  { key: "md-003", molecule: "Nitrogen-containing antioxidant candidate", smiles: "CCN(CC)CCOc1ccccc1O", score: 0.79, status: "Pending validation" },
  { key: "md-004", molecule: "Borate ester candidate", smiles: "CCCOB(OCCC)OCCC", score: 0.76, status: "Pending validation" }
];

export default function MoleculeDesignPage() {
  return (
    <div className="page-grid molecule-prediction-page">
      <PageHeader title="Molecule Design" description="Enter target performance, infer the target descriptor space, and generate candidate molecules." />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item label="Target Friction Coefficient">
              <InputNumber min={0} max={1} step={0.001} defaultValue={0.08} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Target Wear Scar Diameter">
              <InputNumber min={0} addonAfter="um" defaultValue={400} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Target Oxidation Temperature">
              <InputNumber min={0} addonAfter="C" defaultValue={260} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Generation Strategy">
              <Select
                defaultValue="descriptor_inverse"
                options={[
                  { value: "descriptor_inverse", label: "Descriptor Inference" },
                  { value: "similarity_search", label: "Similar-molecule Search" },
                  { value: "fragment_recombine", label: "Fragment Recombination" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Design Action">
              <Button type="primary" block onClick={() => message.success("Molecule design task created.")}>
                Generate Candidates
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
                { title: "Target Descriptor", dataIndex: "descriptor" },
                { title: "Inferred Range", dataIndex: "target" },
                { title: "Model Weight", dataIndex: "weight" }
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
                { title: "Candidate Molecule", dataIndex: "molecule" },
                { title: "Overall Score", dataIndex: "score" },
                { title: "Status", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
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
              <span>Potential Generated Molecule SMILES</span>
              <Tag color="blue">Candidates: {candidateRows.length}</Tag>
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="key"
            columns={[
              { title: "Candidate Molecule", dataIndex: "molecule", width: 180 },
              { title: "SMILES", dataIndex: "smiles", className: "mono" },
              { title: "Overall Score", dataIndex: "score", width: 92 },
              { title: "Status", dataIndex: "status", width: 92, render: (value) => <Tag>{value}</Tag> }
            ]}
            dataSource={candidateRows}
            pagination={false}
          />
        </Card>
      </div>
    </div>
  );
}
