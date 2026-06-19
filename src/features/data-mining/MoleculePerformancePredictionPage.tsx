import * as echarts from "echarts";
import { Button, Card, Checkbox, Form, InputNumber, Modal, Select, Slider, Space, Table, Tag, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";

const featureRows = [
  { key: "descriptor", feature: "RDKit/Mordred 描述符", source: "分子库/描述符中心", status: "ready" },
  { key: "physical", feature: "分子物理性能", source: "分子库", status: "ready" },
  { key: "target", feature: "实验目标性能", source: "实验与性能", status: "pending" }
];

const descriptorFilterRows = [
  { key: "MolLogP", descriptor: "rdkit_MolLogP", group: "理化性质", score: 0.43, reason: "与摩擦系数相关" },
  { key: "TPSA", descriptor: "rdkit_TPSA", group: "极性/表面积", score: 0.39, reason: "互信息得分高" },
  { key: "ABC", descriptor: "mordred_ABC", group: "拓扑结构", score: 0.34, reason: "树模型重要性高" },
  { key: "SlogP", descriptor: "mordred_SLogP", group: "疏水性", score: 0.31, reason: "低共线性保留" }
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
  const chartRef = useRef<HTMLDivElement>(null);
  const shapChartRef = useRef<HTMLDivElement>(null);
  const [trainRatio, setTrainRatio] = useState(80);
  const [keepCount, setKeepCount] = useState(64);
  const [corrThreshold, setCorrThreshold] = useState(0.15);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shapOpen, setShapOpen] = useState(false);

  const split = useMemo(() => {
    const trainCount = Math.max(1, Math.min(baseResultRows.length - 1, Math.round((baseResultRows.length * trainRatio) / 100)));
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
          return value ? `${value[2]}<br/>实际值：${value[0]}<br/>预测值：${value[1]}` : "";
        }
      },
      xAxis: { name: "实际摩擦系数", min: 0.055, max: 0.125, nameGap: 34, nameLocation: "middle" },
      yAxis: {
        name: "预测摩擦系数",
        min: 0.055,
        max: 0.125,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 56
      },
      series: [
        {
          name: "测试集样本",
          type: "scatter",
          symbolSize: 9,
          data: points,
          itemStyle: { color: "#1677ff" }
        },
        {
          name: "理想预测线",
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
  }, [split.testRows]);

  useEffect(() => {
    if (!shapOpen || !shapChartRef.current) return;
    const chart = echarts.init(shapChartRef.current);
    const features = Array.from(new Set(shapRows.map((row) => row.feature))).reverse();
    chart.setOption({
      animation: false,
      grid: { left: 140, right: 72, top: 24, bottom: 54 },
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
      <PageHeader title="分子性能预测" description="分子描述符与物理性能输入，训练目标性能预测模型。" />
      <Card className="table-card prediction-toolbar-card">
        <Form layout="vertical">
          <div className="prediction-controls">
            <Form.Item className="feature-input-item" label="输入特征">
              <Checkbox.Group
                className="feature-checkbox-block"
                defaultValue={["descriptors", "physical"]}
                options={[
                  { value: "descriptors", label: "分子描述符" },
                  { value: "physical", label: "物理性能" },
                  { value: "structure", label: "结构元信息" }
                ]}
              />
            </Form.Item>
            <Form.Item label="目标性能">
              <Select
                defaultValue="average_friction_coefficient"
                options={[
                  { value: "average_friction_coefficient", label: "平均摩擦系数" },
                  { value: "wear_scar_diameter", label: "磨斑直径" },
                  { value: "initial_oxidation_temperature", label: "初始氧化温度" },
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
                  { value: "svr", label: "SVR" },
                  { value: "mlp", label: "MLP" }
                ]}
              />
            </Form.Item>
            <Form.Item label="描述符筛选">
              <Select
                defaultValue="mutual_info"
                options={[
                  { value: "mutual_info", label: "互信息筛选" },
                  { value: "variance_corr", label: "方差 + 相关性" },
                  { value: "model_importance", label: "模型重要性" },
                  { value: "pca", label: "PCA 降维" }
                ]}
              />
            </Form.Item>
            <Form.Item label="保留描述符">
              <InputNumber
                min={16}
                max={512}
                step={16}
                value={keepCount}
                onChange={(value) => setKeepCount(value ?? 64)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item label={`相关阈值：${corrThreshold.toFixed(2)}`}>
              <Slider
                min={0}
                max={0.5}
                step={0.05}
                value={corrThreshold}
                onChange={setCorrThreshold}
                tooltip={{ formatter: null }}
              />
            </Form.Item>
            <Form.Item label={`训练/测试：${trainRatio}/${100 - trainRatio}`}>
              <Slider min={50} max={90} step={5} value={trainRatio} onChange={setTrainRatio} tooltip={{ formatter: null }} />
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
              <Button type="primary" block onClick={() => message.success("分子性能预测模型训练任务已创建。")}>
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
                { title: "特征集", dataIndex: "feature" },
                { title: "数据来源", dataIndex: "source" },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 88,
                  render: (value) => (
                    <Tag color={value === "ready" ? "green" : "gold"}>{value === "ready" ? "就绪" : "待补充"}</Tag>
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
              <Tag color="blue">训练集 {split.trainCount}</Tag>
              <Tag color="green">测试集 {split.testCount}</Tag>
            </Space>
          }
        >
          <div ref={chartRef} className="prediction-chart" />
        </Card>
      </div>
      <Modal title="筛选后描述符" open={filterOpen} onCancel={() => setFilterOpen(false)} footer={null} width={760}>
        <Space size={8} wrap className="modal-tag-row">
          <Tag color="blue">原始 1824</Tag>
          <Tag color="green">保留 {keepCount}</Tag>
          <Tag>相关阈值 {corrThreshold.toFixed(2)}</Tag>
        </Space>
        <Table
          size="small"
          rowKey="key"
          columns={[
            { title: "描述符", dataIndex: "descriptor" },
            { title: "类别", dataIndex: "group" },
            { title: "得分", dataIndex: "score", width: 72 },
            { title: "保留原因", dataIndex: "reason" }
          ]}
          dataSource={descriptorFilterRows}
          pagination={false}
        />
      </Modal>
      <Modal title="SHAP 可解释可视化" open={shapOpen} onCancel={() => setShapOpen(false)} footer={null} width={780}>
        <div ref={shapChartRef} className="shap-chart" />
      </Modal>
    </div>
  );
}
