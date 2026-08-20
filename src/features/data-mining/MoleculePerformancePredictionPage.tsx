import * as echarts from "echarts";
import { Button, Card, Checkbox, Form, InputNumber, Modal, Select, Slider, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { useLanguage } from "../../i18n/LanguageContext";
import { translateBusinessText } from "../../i18n/businessTranslations";

const featureRows = [
  {
    key: "descriptor",
    feature: "RDKit/Mordred Descriptors",
    source: "Molecule Library / Descriptor Center",
    status: "ready"
  },
  { key: "physical", feature: "Molecular Physical Properties", source: "Molecule Library", status: "ready" },
  { key: "target", feature: "Experimental Target Performance", source: "Experiments & Performance", status: "pending" }
];

const descriptorFilterRows = [
  {
    key: "MolLogP",
    descriptor: "rdkit_MolLogP",
    group: "Physicochemical",
    score: 0.43,
    reason: "Correlated with friction coefficient"
  },
  {
    key: "TPSA",
    descriptor: "rdkit_TPSA",
    group: "Polarity / Surface Area",
    score: 0.39,
    reason: "High mutual-information score"
  },
  { key: "ABC", descriptor: "mordred_ABC", group: "Topology", score: 0.34, reason: "High tree-model importance" },
  {
    key: "SlogP",
    descriptor: "mordred_SLogP",
    group: "Hydrophobicity",
    score: 0.31,
    reason: "Retained for low collinearity"
  }
];

const shapRows = [
  { feature: "rdkit_MolLogP", shap: 0.24, featureValue: 0.92, sample: "mol-001" },
  { feature: "rdkit_MolLogP", shap: -0.12, featureValue: 0.28, sample: "mol-002" },
  { feature: "rdkit_MolLogP", shap: 0.08, featureValue: 0.63, sample: "mol-003" },
  { feature: "rdkit_TPSA", shap: -0.18, featureValue: 0.84, sample: "mol-001" },
  { feature: "rdkit_TPSA", shap: 0.06, featureValue: 0.22, sample: "mol-002" },
  { feature: "rdkit_TPSA", shap: -0.1, featureValue: 0.7, sample: "mol-003" },
  { feature: "mordred_ABC", shap: 0.15, featureValue: 0.76, sample: "mol-001" },
  { feature: "mordred_ABC", shap: 0.04, featureValue: 0.48, sample: "mol-002" },
  { feature: "mordred_ABC", shap: -0.06, featureValue: 0.18, sample: "mol-003" },
  { feature: "mordred_SLogP", shap: -0.11, featureValue: 0.16, sample: "mol-001" },
  { feature: "mordred_SLogP", shap: 0.09, featureValue: 0.81, sample: "mol-002" },
  { feature: "mordred_SLogP", shap: -0.04, featureValue: 0.34, sample: "mol-003" },
  { feature: "molecular_weight", shap: 0.08, featureValue: 0.69, sample: "mol-001" },
  { feature: "molecular_weight", shap: -0.05, featureValue: 0.25, sample: "mol-002" },
  { feature: "molecular_weight", shap: 0.03, featureValue: 0.52, sample: "mol-003" }
];

const baseResultRows = [
  { key: "mol-001", molecule: "ZDDP-like", actual: 0.081, predicted: 0.078 },
  { key: "mol-002", molecule: "Phosphate ester", actual: 0.092, predicted: 0.088 },
  { key: "mol-003", molecule: "Friction modifier A", actual: 0.074, predicted: 0.079 },
  { key: "mol-004", molecule: "Antioxidant B", actual: 0.103, predicted: 0.098 },
  { key: "mol-005", molecule: "Sulfur additive", actual: 0.087, predicted: 0.091 },
  { key: "mol-006", molecule: "Nitrogen additive", actual: 0.096, predicted: 0.101 },
  { key: "mol-007", molecule: "Ester candidate", actual: 0.069, predicted: 0.073 },
  { key: "mol-008", molecule: "Boron candidate", actual: 0.112, predicted: 0.107 },
  { key: "mol-009", molecule: "Mo additive", actual: 0.066, predicted: 0.071 },
  { key: "mol-010", molecule: "Zn additive", actual: 0.084, predicted: 0.082 }
];

function buildMetricRows(testRows: typeof baseResultRows) {
  const errors = testRows.map((row) => row.predicted - row.actual);
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
  const actualMean = testRows.reduce((sum, row) => sum + row.actual, 0) / testRows.length;
  const ssRes = errors.reduce((sum, error) => sum + error * error, 0);
  const ssTot = testRows.reduce((sum, row) => sum + Math.pow(row.actual - actualMean, 2), 0);
  const r2 = 1 - ssRes / ssTot;
  return [
    { key: "r2", metric: "R2", validation: Number(r2.toFixed(3)) },
    { key: "mae", metric: "MAE", validation: Number(mae.toFixed(3)) },
    { key: "rmse", metric: "RMSE", validation: Number(rmse.toFixed(3)) }
  ];
}

export default function MoleculePerformancePredictionPage() {
  const { language } = useLanguage();
  const ui = useCallback((text: string) => translateBusinessText(text, language), [language]);
  const chartRef = useRef<HTMLDivElement>(null);
  const shapChartRef = useRef<HTMLDivElement>(null);
  const [trainRatio, setTrainRatio] = useState(80);
  const [keepCount, setKeepCount] = useState(64);
  const [corrThreshold, setCorrThreshold] = useState(0.15);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shapOpen, setShapOpen] = useState(false);

  const split = useMemo(() => {
    const trainCount = Math.max(
      1,
      Math.min(baseResultRows.length - 1, Math.round((baseResultRows.length * trainRatio) / 100))
    );
    return {
      trainCount,
      testCount: baseResultRows.length - trainCount,
      testRows: baseResultRows.slice(trainCount)
    };
  }, [trainRatio]);

  const metricRows = useMemo(() => buildMetricRows(split.testRows), [split.testRows]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const points = split.testRows.map((row) => [row.actual, row.predicted, row.molecule]);
    chart.setOption({
      animation: false,
      grid: { left: 86, right: 48, top: 36, bottom: 62, containLabel: false },
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const value = (params as { value?: [number, number, string] }).value;
          return value ? `${value[2]}<br/>${ui("Actual")}: ${value[0]}<br/>${ui("Predicted")}: ${value[1]}` : "";
        }
      },
      xAxis: { name: ui("Actual Friction Coefficient"), min: 0.055, max: 0.125, nameGap: 34, nameLocation: "middle" },
      yAxis: {
        name: ui("Predicted Friction Coefficient"),
        min: 0.055,
        max: 0.125,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 56
      },
      series: [
        {
          name: ui("Test-set Samples"),
          type: "scatter",
          symbolSize: 9,
          data: points,
          itemStyle: { color: "#1677ff" }
        },
        {
          name: ui("Ideal Prediction Line"),
          type: "line",
          data: [
            [0.06, 0.06],
            [0.12, 0.12]
          ],
          showSymbol: false,
          lineStyle: { color: "#10b981", type: "dashed", width: 2 }
        }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [split.testRows, ui]);

  useEffect(() => {
    if (!shapOpen || !shapChartRef.current) return;
    const chart = echarts.init(shapChartRef.current);
    const features = Array.from(new Set(shapRows.map((row) => ui(row.feature)))).reverse();
    chart.setOption({
      animation: false,
      grid: { left: 140, right: 72, top: 24, bottom: 54 },
      visualMap: {
        min: 0,
        max: 1,
        right: 0,
        top: 24,
        itemHeight: 160,
        text: [ui("High"), ui("Low")],
        dimension: 2,
        inRange: { color: ["#1677ff", "#f43f5e"] }
      },
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const value = (params as { data?: [number, string, number, string] }).data;
          return value
            ? `${value[3]}<br/>${ui(value[1])}<br/>SHAP: ${value[0]}<br/>${ui("Feature value")}: ${value[2]}`
            : "";
        }
      },
      xAxis: { type: "value", name: ui("SHAP Value"), splitLine: { lineStyle: { type: "dashed" } } },
      yAxis: { type: "category", data: features },
      series: [
        {
          name: ui("Sample SHAP"),
          type: "scatter",
          symbolSize: 10,
          data: shapRows.map((row) => [row.shap, ui(row.feature), row.featureValue, row.sample])
        }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(shapChartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [shapOpen, ui]);

  return (
    <div className="page-grid molecule-prediction-page">
      <PageHeader
        title="Molecule Performance Prediction"
        description="Train a target-performance model from molecular descriptors and physical properties."
      />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item className="feature-input-item" label="Input Features">
              <Checkbox.Group
                className="feature-checkbox-block"
                defaultValue={["descriptors", "physical"]}
                options={[
                  { value: "descriptors", label: "Molecular Descriptors" },
                  { value: "physical", label: "Physical Properties" },
                  { value: "structure", label: "Structure Metadata" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Target Performance">
              <Select
                defaultValue="average_friction_coefficient"
                options={[
                  { value: "average_friction_coefficient", label: "Average Friction Coefficient" },
                  { value: "wear_scar_diameter", label: "Wear Scar Diameter" },
                  { value: "initial_oxidation_temperature", label: "Initial Oxidation Temperature" },
                  { value: "extreme_pressure_value", label: "Extreme-pressure Value" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Machine-learning Model">
              <Select
                defaultValue="random_forest"
                options={[
                  { value: "random_forest", label: "Random Forest" },
                  { value: "xgboost", label: "XGBoost" },
                  { value: "svr", label: "SVR" },
                  { value: "mlp", label: "MLP" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Descriptor Selection">
              <Select
                defaultValue="mutual_info"
                options={[
                  { value: "mutual_info", label: "Mutual Information" },
                  { value: "variance_corr", label: "Variance + Correlation" },
                  { value: "model_importance", label: "Model Importance" },
                  { value: "pca", label: "PCA Reduction" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Descriptors to Keep">
              <InputNumber
                min={16}
                max={512}
                step={16}
                value={keepCount}
                onChange={(value) => setKeepCount(value ?? 64)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label={`Correlation Threshold: ${corrThreshold.toFixed(2)}`}>
              <Slider
                min={0}
                max={0.5}
                step={0.05}
                value={corrThreshold}
                onChange={setCorrThreshold}
                tooltip={{ formatter: null }}
              />
            </Form.Item>
            <Form.Item label={`Train / Test: ${trainRatio}/${100 - trainRatio}`}>
              <Slider
                min={50}
                max={90}
                step={5}
                value={trainRatio}
                onChange={setTrainRatio}
                tooltip={{ formatter: null }}
              />
            </Form.Item>
            <Form.Item label="Selection Results">
              <Button block onClick={() => setFilterOpen(true)}>
                View Results
              </Button>
            </Form.Item>
            <Form.Item label="Explainable Machine Learning">
              <Button block onClick={() => setShapOpen(true)}>
                SHAP Visualization
              </Button>
            </Form.Item>
            <Form.Item label="Training Action">
              <Button
                type="primary"
                block
                onClick={() => message.success("Molecule-performance model training task created.")}
              >
                Train Model
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
                { title: "Feature Set", dataIndex: "feature" },
                { title: "Data Source", dataIndex: "source" },
                {
                  title: "Status",
                  dataIndex: "status",
                  width: 88,
                  render: (value) => (
                    <Tag color={value === "ready" ? "green" : "gold"}>{value === "ready" ? "Ready" : "Incomplete"}</Tag>
                  )
                }
              ]}
              dataSource={featureRows}
              pagination={false}
            />
          </Card>
          <Card className="table-card">
            <Table
              size="small"
              rowKey="key"
              columns={[
                { title: "Metric", dataIndex: "metric" },
                { title: "Test Set", dataIndex: "validation" }
              ]}
              dataSource={metricRows}
              pagination={false}
            />
          </Card>
        </div>
        <Card
          className="table-card prediction-chart-card"
          title={
            <Space size={10} wrap>
              <span>Test-results Visualization</span>
              <Tag color="blue">Training Set: {split.trainCount}</Tag>
              <Tag color="green">Test Set: {split.testCount}</Tag>
            </Space>
          }
        >
          <div ref={chartRef} className="prediction-chart" />
        </Card>
      </div>
      <Modal
        title="Selected Descriptors"
        open={filterOpen}
        onCancel={() => setFilterOpen(false)}
        footer={null}
        width={760}
      >
        <Space size={8} wrap className="modal-tag-row">
          <Tag color="blue">Original: 1824</Tag>
          <Tag color="green">Kept: {keepCount}</Tag>
          <Tag>Correlation Threshold: {corrThreshold.toFixed(2)}</Tag>
        </Space>
        <Table
          size="small"
          rowKey="key"
          columns={[
            { title: "Descriptor", dataIndex: "descriptor" },
            { title: "Category", dataIndex: "group" },
            { title: "Score", dataIndex: "score", width: 72 },
            { title: "Reason Kept", dataIndex: "reason" }
          ]}
          dataSource={descriptorFilterRows}
          pagination={false}
        />
      </Modal>
      <Modal
        title="SHAP Explainability Visualization"
        open={shapOpen}
        onCancel={() => setShapOpen(false)}
        footer={null}
        width={780}
      >
        <div ref={shapChartRef} className="shap-chart" />
      </Modal>
    </div>
  );
}
