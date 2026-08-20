import * as echarts from "echarts";
import { Button, Card, Checkbox, Form, InputNumber, Modal, Select, Slider, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { useLanguage } from "../../i18n/LanguageContext";
import { translateBusinessText } from "../../i18n/businessTranslations";

const trainingRows = [
  {
    key: "composition",
    dataset: "Formulation Ratios",
    fields: "Base oils, additives, mass fractions",
    status: "ready"
  },
  {
    key: "experiment",
    dataset: "Experimental Data",
    fields: "Load, temperature, duration, materials",
    status: "ready"
  },
  {
    key: "descriptor",
    dataset: "Molecular Descriptors",
    fields: "RDKit/Mordred descriptors for formulation molecules",
    status: "ready"
  },
  {
    key: "target",
    dataset: "Friction Performance",
    fields: "Friction coefficient, wear scar, extreme-pressure value",
    status: "pending"
  }
];

const metricRows = [
  { key: "r2", metric: "R2", validation: 0.814 },
  { key: "mae", metric: "MAE", validation: 0.006 },
  { key: "rmse", metric: "RMSE", validation: 0.009 }
];

const featureFilterRows = [
  {
    key: "zddp_ratio",
    feature: "ZDDP Mass Fraction",
    group: "Formulation Ratio",
    score: 0.48,
    reason: "High contribution to wear and friction"
  },
  {
    key: "load_temperature",
    feature: "Load x Temperature",
    group: "Test Conditions",
    score: 0.41,
    reason: "High interaction importance"
  },
  {
    key: "avg_mollogp",
    feature: "Weighted Component MolLogP",
    group: "Descriptor Aggregation",
    score: 0.37,
    reason: "Related to oil-film formation"
  },
  {
    key: "max_tpsa",
    feature: "Maximum Component TPSA",
    group: "Descriptor Aggregation",
    score: 0.29,
    reason: "Retained for low collinearity"
  }
];

const shapRows = [
  { feature: "ZDDP Mass Fraction", shap: -0.27, featureValue: 0.22, sample: "fp-001" },
  { feature: "ZDDP Mass Fraction", shap: -0.16, featureValue: 0.36, sample: "fp-002" },
  { feature: "ZDDP Mass Fraction", shap: 0.08, featureValue: 0.82, sample: "fp-003" },
  { feature: "Load x Temperature", shap: 0.21, featureValue: 0.88, sample: "fp-001" },
  { feature: "Load x Temperature", shap: 0.11, featureValue: 0.62, sample: "fp-002" },
  { feature: "Load x Temperature", shap: -0.05, featureValue: 0.24, sample: "fp-003" },
  { feature: "Weighted MolLogP", shap: -0.16, featureValue: 0.32, sample: "fp-001" },
  { feature: "Weighted MolLogP", shap: 0.07, featureValue: 0.72, sample: "fp-002" },
  { feature: "Weighted MolLogP", shap: -0.09, featureValue: 0.44, sample: "fp-003" },
  { feature: "Maximum TPSA", shap: 0.1, featureValue: 0.76, sample: "fp-001" },
  { feature: "Maximum TPSA", shap: -0.04, featureValue: 0.26, sample: "fp-002" },
  { feature: "Maximum TPSA", shap: 0.03, featureValue: 0.58, sample: "fp-003" },
  { feature: "Base-oil Viscosity", shap: -0.08, featureValue: 0.2, sample: "fp-001" },
  { feature: "Base-oil Viscosity", shap: 0.05, featureValue: 0.64, sample: "fp-002" },
  { feature: "Base-oil Viscosity", shap: -0.03, featureValue: 0.38, sample: "fp-003" }
];

const predictionRows = [
  {
    key: "fp-001",
    formulation: "PAO-6 + ZDDP 0.8% + Antioxidant 0.2%",
    actual: 0.081,
    predicted: 0.079,
    confidence: 0.82
  },
  {
    key: "fp-002",
    formulation: "Ester Oil + Phosphate Ester 1.0% + Dispersant 0.3%",
    actual: 0.091,
    predicted: 0.086,
    confidence: 0.76
  },
  {
    key: "fp-003",
    formulation: "PAO-8 + Sulfurized Additive 0.6% + Antioxidant 0.4%",
    actual: 0.074,
    predicted: 0.077,
    confidence: 0.8
  }
];

export default function FormulationPredictionPage() {
  const { language } = useLanguage();
  const ui = useCallback((text: string) => translateBusinessText(text, language), [language]);
  const chartRef = useRef<HTMLDivElement>(null);
  const shapChartRef = useRef<HTMLDivElement>(null);
  const [keepCount, setKeepCount] = useState(96);
  const [corrThreshold, setCorrThreshold] = useState(0.2);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shapOpen, setShapOpen] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      animation: false,
      grid: { left: 56, right: 24, top: 34, bottom: 58, containLabel: true },
      tooltip: { trigger: "axis" },
      legend: { top: 0, right: 0 },
      xAxis: {
        type: "category",
        data: predictionRows.map((row) => row.key),
        name: ui("Test Formulation"),
        nameGap: 30
      },
      yAxis: { type: "value", name: ui("Friction Coefficient"), min: 0.06, max: 0.1 },
      series: [
        {
          name: ui("Actual"),
          type: "bar",
          data: predictionRows.map((row) => row.actual),
          itemStyle: { color: "#1677ff" }
        },
        {
          name: ui("Predicted"),
          type: "bar",
          data: predictionRows.map((row) => row.predicted),
          itemStyle: { color: "#10b981" }
        }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [ui]);

  useEffect(() => {
    if (!shapOpen || !shapChartRef.current) return;
    const chart = echarts.init(shapChartRef.current);
    const features = Array.from(new Set(shapRows.map((row) => ui(row.feature)))).reverse();
    chart.setOption({
      animation: false,
      grid: { left: 150, right: 72, top: 24, bottom: 54 },
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
        title="Formulation Prediction"
        description="Train a friction-performance model using formulation ratios, test conditions, and molecular descriptors."
      />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item className="feature-input-item" label="Training Data">
              <Checkbox.Group
                className="feature-checkbox-block"
                defaultValue={["composition", "experiment", "descriptors"]}
                options={[
                  { value: "composition", label: "Formulation Ratios" },
                  { value: "experiment", label: "Experimental Data" },
                  { value: "descriptors", label: "Molecular Descriptors" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Prediction Target">
              <Select
                mode="multiple"
                defaultValue={["average_friction_coefficient", "wear_scar_diameter"]}
                options={[
                  { value: "average_friction_coefficient", label: "Average Friction Coefficient" },
                  { value: "wear_scar_diameter", label: "Wear Scar Diameter" },
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
                  { value: "gpr", label: "Gaussian Process" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Feature Selection">
              <Select
                defaultValue="model_importance"
                options={[
                  { value: "model_importance", label: "Model Importance" },
                  { value: "mutual_info", label: "Mutual Information" },
                  { value: "variance_corr", label: "Variance + Correlation" },
                  { value: "elastic_net", label: "ElasticNet Sparse Selection" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Features to Keep">
              <InputNumber
                min={16}
                max={512}
                step={16}
                value={keepCount}
                onChange={(value) => setKeepCount(value ?? 96)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label={`Correlation Threshold: ${corrThreshold.toFixed(2)}`}>
              <Slider
                min={0}
                max={0.6}
                step={0.05}
                value={corrThreshold}
                onChange={setCorrThreshold}
                tooltip={{ formatter: null }}
              />
            </Form.Item>
            <Form.Item label="Cross-validation Folds">
              <InputNumber min={3} max={10} defaultValue={5} style={{ width: "100%" }} />
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
                onClick={() => message.success("Formulation-prediction model training task created.")}
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
                { title: "Dataset", dataIndex: "dataset" },
                { title: "Fields", dataIndex: "fields" },
                {
                  title: "Status",
                  dataIndex: "status",
                  width: 88,
                  render: (value) => (
                    <Tag color={value === "ready" ? "green" : "gold"}>{value === "ready" ? "Ready" : "Incomplete"}</Tag>
                  )
                }
              ]}
              dataSource={trainingRows}
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
              <Tag color="blue">Test Formulations: {predictionRows.length}</Tag>
            </Space>
          }
        >
          <div ref={chartRef} className="prediction-chart" />
        </Card>
      </div>
      <Modal
        title="Selected Features"
        open={filterOpen}
        onCancel={() => setFilterOpen(false)}
        footer={null}
        width={780}
      >
        <Space size={8} wrap className="modal-tag-row">
          <Tag color="blue">Original: 2380</Tag>
          <Tag color="green">Kept: {keepCount}</Tag>
          <Tag>Correlation Threshold: {corrThreshold.toFixed(2)}</Tag>
        </Space>
        <Table
          size="small"
          rowKey="key"
          columns={[
            { title: "Feature", dataIndex: "feature" },
            { title: "Category", dataIndex: "group" },
            { title: "Score", dataIndex: "score", width: 72 },
            { title: "Reason Kept", dataIndex: "reason" }
          ]}
          dataSource={featureFilterRows}
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
