import * as echarts from "echarts";
import { Button, Card, Checkbox, Form, InputNumber, Modal, Select, Slider, Space, Table, Tag, message } from "antd";
import { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";

const trainingRows = [
  { key: "composition", dataset: "配方比例", fields: "基础油、添加剂、质量分数", status: "ready" },
  { key: "experiment", dataset: "实验数据", fields: "载荷、温度、时长、材料", status: "ready" },
  { key: "descriptor", dataset: "分子描述符", fields: "配方中各分子的 RDKit/Mordred 描述符", status: "ready" },
  { key: "target", dataset: "摩擦性能", fields: "摩擦系数、磨斑、极压值", status: "pending" }
];

const metricRows = [
  { key: "r2", metric: "R2", validation: 0.814 },
  { key: "mae", metric: "MAE", validation: 0.006 },
  { key: "rmse", metric: "RMSE", validation: 0.009 }
];

const featureFilterRows = [
  { key: "zddp_ratio", feature: "ZDDP 质量分数", group: "配方比例", score: 0.48, reason: "对磨斑和摩擦贡献高" },
  { key: "load_temperature", feature: "载荷 x 温度", group: "实验条件", score: 0.41, reason: "交互项重要性高" },
  { key: "avg_mollogp", feature: "组分 MolLogP 加权均值", group: "分子描述符聚合", score: 0.37, reason: "与油膜形成相关" },
  { key: "max_tpsa", feature: "组分 TPSA 最大值", group: "分子描述符聚合", score: 0.29, reason: "低共线性保留" }
];

const shapRows = [
  { feature: "ZDDP 质量分数", shap: -0.27, featureValue: 0.22, sample: "fp-001" },
  { feature: "ZDDP 质量分数", shap: -0.16, featureValue: 0.36, sample: "fp-002" },
  { feature: "ZDDP 质量分数", shap: 0.08, featureValue: 0.82, sample: "fp-003" },
  { feature: "载荷 x 温度", shap: 0.21, featureValue: 0.88, sample: "fp-001" },
  { feature: "载荷 x 温度", shap: 0.11, featureValue: 0.62, sample: "fp-002" },
  { feature: "载荷 x 温度", shap: -0.05, featureValue: 0.24, sample: "fp-003" },
  { feature: "MolLogP 加权均值", shap: -0.16, featureValue: 0.32, sample: "fp-001" },
  { feature: "MolLogP 加权均值", shap: 0.07, featureValue: 0.72, sample: "fp-002" },
  { feature: "MolLogP 加权均值", shap: -0.09, featureValue: 0.44, sample: "fp-003" },
  { feature: "TPSA 最大值", shap: 0.1, featureValue: 0.76, sample: "fp-001" },
  { feature: "TPSA 最大值", shap: -0.04, featureValue: 0.26, sample: "fp-002" },
  { feature: "TPSA 最大值", shap: 0.03, featureValue: 0.58, sample: "fp-003" },
  { feature: "基础油黏度", shap: -0.08, featureValue: 0.2, sample: "fp-001" },
  { feature: "基础油黏度", shap: 0.05, featureValue: 0.64, sample: "fp-002" },
  { feature: "基础油黏度", shap: -0.03, featureValue: 0.38, sample: "fp-003" }
];

const predictionRows = [
  { key: "fp-001", formulation: "PAO-6 + ZDDP 0.8% + 抗氧剂 0.2%", actual: 0.081, predicted: 0.079, confidence: 0.82 },
  { key: "fp-002", formulation: "酯类油 + 磷酸酯 1.0% + 分散剂 0.3%", actual: 0.091, predicted: 0.086, confidence: 0.76 },
  { key: "fp-003", formulation: "PAO-8 + 硫化添加剂 0.6% + 抗氧剂 0.4%", actual: 0.074, predicted: 0.077, confidence: 0.8 }
];

export default function FormulationPredictionPage() {
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
      xAxis: { type: "category", data: predictionRows.map((row) => row.key), name: "测试配方", nameGap: 30 },
      yAxis: { type: "value", name: "摩擦系数", min: 0.06, max: 0.1 },
      series: [
        { name: "实验值", type: "bar", data: predictionRows.map((row) => row.actual), itemStyle: { color: "#1677ff" } },
        { name: "预测值", type: "bar", data: predictionRows.map((row) => row.predicted), itemStyle: { color: "#10b981" } }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    if (!shapOpen || !shapChartRef.current) return;
    const chart = echarts.init(shapChartRef.current);
    const features = Array.from(new Set(shapRows.map((row) => row.feature))).reverse();
    chart.setOption({
      animation: false,
      grid: { left: 150, right: 72, top: 24, bottom: 54 },
      visualMap: {
        min: 0,
        max: 1,
        right: 0,
        top: 24,
        itemHeight: 160,
        text: ["高", "低"],
        dimension: 2,
        inRange: { color: ["#1677ff", "#f43f5e"] }
      },
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const value = (params as { data?: [number, string, number, string] }).data;
          return value ? `${value[3]}<br/>${value[1]}<br/>SHAP：${value[0]}<br/>特征值：${value[2]}` : "";
        }
      },
      xAxis: { type: "value", name: "SHAP 值", splitLine: { lineStyle: { type: "dashed" } } },
      yAxis: { type: "category", data: features },
      series: [
        {
          name: "样本 SHAP",
          type: "scatter",
          symbolSize: 10,
          data: shapRows.map((row) => [row.shap, row.feature, row.featureValue, row.sample])
        }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(shapChartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [shapOpen]);

  return (
    <div className="page-grid molecule-prediction-page">
      <PageHeader title="配方预测" description="配方比例、实验条件和分子描述符输入，训练摩擦性能预测模型。" />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item className="feature-input-item" label="训练数据">
              <Checkbox.Group
                className="feature-checkbox-block"
                defaultValue={["composition", "experiment", "descriptors"]}
                options={[
                  { value: "composition", label: "配方比例" },
                  { value: "experiment", label: "实验数据" },
                  { value: "descriptors", label: "分子描述符" }
                ]}
              />
            </Form.Item>
            <Form.Item label="预测目标">
              <Select
                mode="multiple"
                defaultValue={["average_friction_coefficient", "wear_scar_diameter"]}
                options={[
                  { value: "average_friction_coefficient", label: "平均摩擦系数" },
                  { value: "wear_scar_diameter", label: "磨斑直径" },
                  { value: "extreme_pressure_value", label: "极压值" }
                ]}
              />
            </Form.Item>
            <Form.Item label="机器学习模型">
              <Select
                defaultValue="random_forest"
                options={[
                  { value: "random_forest", label: "Random Forest" },
                  { value: "xgboost", label: "XGBoost" },
                  { value: "gpr", label: "Gaussian Process" }
                ]}
              />
            </Form.Item>
            <Form.Item label="特征筛选">
              <Select
                defaultValue="model_importance"
                options={[
                  { value: "model_importance", label: "模型重要性" },
                  { value: "mutual_info", label: "互信息筛选" },
                  { value: "variance_corr", label: "方差 + 相关性" },
                  { value: "elastic_net", label: "ElasticNet 稀疏筛选" }
                ]}
              />
            </Form.Item>
            <Form.Item label="保留特征">
              <InputNumber
                min={16}
                max={512}
                step={16}
                value={keepCount}
                onChange={(value) => setKeepCount(value ?? 96)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label={`相关阈值：${corrThreshold.toFixed(2)}`}>
              <Slider min={0} max={0.6} step={0.05} value={corrThreshold} onChange={setCorrThreshold} tooltip={{ formatter: null }} />
            </Form.Item>
            <Form.Item label="交叉验证折数">
              <InputNumber min={3} max={10} defaultValue={5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="筛选结果">
              <Button block onClick={() => setFilterOpen(true)}>
                筛选结果
              </Button>
            </Form.Item>
            <Form.Item label="可解释机器学习">
              <Button block onClick={() => setShapOpen(true)}>
                SHAP 可视化
              </Button>
            </Form.Item>
            <Form.Item label="训练动作">
              <Button type="primary" block onClick={() => message.success("配方预测模型训练任务已创建。")}>
                训练模型
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
                { title: "数据集", dataIndex: "dataset" },
                { title: "字段", dataIndex: "fields" },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 88,
                  render: (value) => <Tag color={value === "ready" ? "green" : "gold"}>{value === "ready" ? "就绪" : "待补充"}</Tag>
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
                { title: "指标", dataIndex: "metric" },
                { title: "测试集", dataIndex: "validation" }
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
              <span>测试结果可视化</span>
              <Tag color="blue">测试配方 {predictionRows.length}</Tag>
            </Space>
          }
        >
          <div ref={chartRef} className="prediction-chart" />
        </Card>
      </div>
      <Modal title="筛选后特征" open={filterOpen} onCancel={() => setFilterOpen(false)} footer={null} width={780}>
        <Space size={8} wrap className="modal-tag-row">
          <Tag color="blue">原始 2380</Tag>
          <Tag color="green">保留 {keepCount}</Tag>
          <Tag>相关阈值 {corrThreshold.toFixed(2)}</Tag>
        </Space>
        <Table
          size="small"
          rowKey="key"
          columns={[
            { title: "特征", dataIndex: "feature" },
            { title: "类别", dataIndex: "group" },
            { title: "得分", dataIndex: "score", width: 72 },
            { title: "保留原因", dataIndex: "reason" }
          ]}
          dataSource={featureFilterRows}
          pagination={false}
        />
      </Modal>
      <Modal title="SHAP 可解释可视化" open={shapOpen} onCancel={() => setShapOpen(false)} footer={null} width={780}>
        <div ref={shapChartRef} className="shap-chart" />
      </Modal>
    </div>
  );
}
