import { Button, Card, Checkbox, Form, InputNumber, Select, Table, Tabs, Tag, message } from "antd";
import PageHeader from "../../components/PageHeader";
import { commonOptionLabels } from "../../lib/constants";

const candidateRows = [
  {
    key: "cand-001",
    molecule: "ZDDP-like Additive",
    predictionScore: 0.88,
    uncertainty: 0.07,
    reason: "Strong P/S/Zn antiwear descriptor characteristics."
  },
  {
    key: "cand-002",
    molecule: "Phosphate Ester Additive",
    predictionScore: 0.81,
    uncertainty: 0.11,
    reason: "Balanced TPSA and phosphorus-containing descriptors."
  }
];

const formulationRows = [
  {
    key: "opt-001",
    formulation: "PAO-6 + ZDDP 0.8% + Antioxidant 0.2%",
    friction: 0.079,
    wear: 405,
    oxidation: 262,
    ep: 650
  }
];

export default function AnalysisDesignPage() {
  return (
    <div className="page-grid analysis-page">
      <PageHeader
        title="Data Analysis / Intelligent Design"
        description="A simulated analysis and design workspace using stored RDKit and Mordred descriptors as machine-learning inputs."
      />
      <Card>
        <Tabs
          items={[
            {
              key: "performance",
              label: "Performance Analysis",
              children: (
                <Card title="Performance Comparison Placeholder">
                  Additive, base-oil, concentration-friction, wear-scar, and PDSC comparisons will be displayed with ECharts in a future release.
                </Card>
              )
            },
            {
              key: "descriptor-property",
              label: "Descriptor–Performance Relationship",
              children: (
                <Form layout="inline">
                  <Form.Item label="Descriptor X">
                    <Select style={{ width: 220 }} defaultValue="rdkit_MolLogP" options={["rdkit_MolLogP", "rdkit_TPSA", "mordred_ABC"].map((value) => ({ value, label: value }))} />
                  </Form.Item>
                  <Form.Item label="Performance Y">
                    <Select
                      style={{ width: 240 }}
                      defaultValue="average_friction_coefficient"
                      options={[
                        { value: "average_friction_coefficient", label: "Average Friction Coefficient" },
                        { value: "wear_scar_diameter", label: "Wear Scar Diameter" },
                        { value: "initial_oxidation_temperature", label: "Initial Oxidation Temperature" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Descriptor Set">
                    <Select style={{ width: 180 }} defaultValue="both" options={["rdkit only", "mordred only", "both"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} />
                  </Form.Item>
                  <Button onClick={() => message.info("The simulated scatter plot was refreshed.")}>Generate Scatter Plot</Button>
                  <Card style={{ width: "100%", marginTop: 16 }}>Pearson / Spearman correlation placeholder.</Card>
                </Form>
              )
            },
            {
              key: "additive-design",
              label: "Additive Design",
              children: (
                <div className="page-grid">
                  <Form layout="inline">
                    <Form.Item label="Target Performance">
                      <Select style={{ width: 240 }} defaultValue="low friction coefficient" options={["low friction coefficient", "small wear scar", "high oxidation temperature", "high extreme pressure value"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} />
                    </Form.Item>
                    <Form.Item label="Molecular-weight Range"><InputNumber placeholder="Minimum" /> - <InputNumber placeholder="Maximum" /></Form.Item>
                    <Form.Item label="Required Elements">
                      <Select mode="multiple" style={{ width: 180 }} options={["S", "P", "N", "O", "B", "Mo", "Zn"].map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Button type="primary">Run Additive-design Simulation</Button>
                  </Form>
                  <Table
                    rowKey="key"
                    columns={[
                      { title: "Candidate Molecule", dataIndex: "molecule" },
                      { title: "Predicted Score", dataIndex: "predictionScore" },
                      { title: "Uncertainty", dataIndex: "uncertainty" },
                      { title: "Recommendation Rationale", dataIndex: "reason" }
                    ]}
                    dataSource={candidateRows}
                    pagination={false}
                  />
                </div>
              )
            },
            {
              key: "formulation-design",
              label: "Formulation Design",
              children: (
                <div className="page-grid">
                  <Form layout="inline">
                    <Form.Item label="Base Oil">
                      <Select
                        style={{ width: 160 }}
                        defaultValue="PAO-6"
                        options={[
                          { value: "PAO-6", label: "PAO-6" },
                          { value: "Mineral oil SN150", label: "Mineral Oil SN150" },
                          { value: "Ester oil", label: "Ester Oil" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="Maximum Total Additive"><InputNumber addonAfter="wt%" defaultValue={2} /></Form.Item>
                    <Form.Item label="Optimization Target"><Select style={{ width: 220 }} defaultValue="balanced" options={["balanced", "minimum friction", "minimum wear", "oxidation stability"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} /></Form.Item>
                    <Button type="primary">Run Formulation-design Simulation</Button>
                  </Form>
                  <Table
                    rowKey="key"
                    columns={[
                      { title: "Recommended Formulation", dataIndex: "formulation" },
                      { title: "Predicted Friction Coefficient", dataIndex: "friction" },
                      { title: "Predicted Wear Scar Diameter", dataIndex: "wear" },
                      { title: "Predicted Oxidation Temperature", dataIndex: "oxidation" },
                      { title: "Predicted Extreme-pressure Value", dataIndex: "ep" }
                    ]}
                    dataSource={formulationRows}
                    pagination={false}
                  />
                </div>
              )
            },
            {
              key: "ml-export",
              label: "Machine-learning Dataset Export",
              children: (
                <Form layout="vertical">
                  <Form.Item label="Target Performance">
                    <Select
                      mode="multiple"
                      defaultValue={["average_friction_coefficient"]}
                      options={[
                        { value: "average_friction_coefficient", label: "Average Friction Coefficient" },
                        { value: "wear_scar_diameter", label: "Wear Scar Diameter" },
                        { value: "initial_oxidation_temperature", label: "Initial Oxidation Temperature" },
                        { value: "extreme_pressure_value", label: "Extreme-pressure Value" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Input Features">
                    <Checkbox.Group
                      defaultValue={["molecule descriptors", "formulation composition"]}
                      options={[
                        { value: "molecule descriptors", label: "Molecular Descriptors" },
                        { value: "formulation composition", label: "Formulation Composition" },
                        { value: "test conditions", label: "Test Conditions" }
                      ]}
                    />
                  </Form.Item>
                  <Button.Group>
                    <Button>Export Descriptor-only Dataset</Button>
                    <Button>Export Formulation–Performance Dataset</Button>
                    <Button type="primary">Export Complete ML Dataset</Button>
                  </Button.Group>
                  <div style={{ marginTop: 12 }}>
                    <Tag color="green">RDKit Descriptors</Tag>
                    <Tag>CSV Export Simulation</Tag>
                  </div>
                </Form>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}
