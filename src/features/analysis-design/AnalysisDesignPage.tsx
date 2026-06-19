import { Button, Card, Checkbox, Form, InputNumber, Select, Table, Tabs, Tag, message } from "antd";
import PageHeader from "../../components/PageHeader";
import { commonOptionLabels } from "../../lib/constants";

const candidateRows = [
  {
    key: "cand-001",
    molecule: "类 ZDDP 添加剂",
    predictionScore: 0.88,
    uncertainty: 0.07,
    reason: "P/S/Zn 抗磨描述符特征明显。"
  },
  {
    key: "cand-002",
    molecule: "磷酸酯添加剂",
    predictionScore: 0.81,
    uncertainty: 0.11,
    reason: "TPSA 与含磷描述符表现均衡。"
  }
];

const formulationRows = [
  {
    key: "opt-001",
    formulation: "PAO-6 + ZDDP 0.8% + 抗氧剂 0.2%",
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
        title="数据分析/智能设计"
        description="使用隐藏的 RDKit + Mordred 描述符作为后续机器学习输入的模拟分析与设计工作区。"
      />
      <Card>
        <Tabs
          items={[
            {
              key: "performance",
              label: "性能分析",
              children: (
                <Card title="性能对比占位">
                  不同添加剂、基础油、浓度-摩擦曲线、磨斑曲线和 PDSC 对比将在下一阶段使用 ECharts 展示。
                </Card>
              )
            },
            {
              key: "descriptor-property",
              label: "描述符-性能关系",
              children: (
                <Form layout="inline">
                  <Form.Item label="描述符 X">
                    <Select style={{ width: 220 }} defaultValue="rdkit_MolLogP" options={["rdkit_MolLogP", "rdkit_TPSA", "mordred_ABC"].map((value) => ({ value, label: value }))} />
                  </Form.Item>
                  <Form.Item label="性能 Y">
                    <Select
                      style={{ width: 240 }}
                      defaultValue="average_friction_coefficient"
                      options={[
                        { value: "average_friction_coefficient", label: "平均摩擦系数" },
                        { value: "wear_scar_diameter", label: "磨斑直径" },
                        { value: "initial_oxidation_temperature", label: "初始氧化温度" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="描述符集合">
                    <Select style={{ width: 180 }} defaultValue="both" options={["rdkit only", "mordred only", "both"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} />
                  </Form.Item>
                  <Button onClick={() => message.info("散点图模拟结果已刷新。")}>生成散点图</Button>
                  <Card style={{ width: "100%", marginTop: 16 }}>Pearson / Spearman 相关性占位。</Card>
                </Form>
              )
            },
            {
              key: "additive-design",
              label: "添加剂设计",
              children: (
                <div className="page-grid">
                  <Form layout="inline">
                    <Form.Item label="目标性能">
                      <Select style={{ width: 240 }} defaultValue="low friction coefficient" options={["low friction coefficient", "small wear scar", "high oxidation temperature", "high extreme pressure value"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} />
                    </Form.Item>
                    <Form.Item label="分子量范围"><InputNumber placeholder="最小" /> - <InputNumber placeholder="最大" /></Form.Item>
                    <Form.Item label="包含元素">
                      <Select mode="multiple" style={{ width: 180 }} options={["S", "P", "N", "O", "B", "Mo", "Zn"].map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Button type="primary">运行添加剂设计模拟</Button>
                  </Form>
                  <Table
                    rowKey="key"
                    columns={[
                      { title: "候选分子", dataIndex: "molecule" },
                      { title: "预测评分", dataIndex: "predictionScore" },
                      { title: "不确定性", dataIndex: "uncertainty" },
                      { title: "推荐理由", dataIndex: "reason" }
                    ]}
                    dataSource={candidateRows}
                    pagination={false}
                  />
                </div>
              )
            },
            {
              key: "formulation-design",
              label: "配方设计",
              children: (
                <div className="page-grid">
                  <Form layout="inline">
                    <Form.Item label="基础油">
                      <Select
                        style={{ width: 160 }}
                        defaultValue="PAO-6"
                        options={[
                          { value: "PAO-6", label: "PAO-6" },
                          { value: "Mineral oil SN150", label: "矿物油 SN150" },
                          { value: "Ester oil", label: "酯类油" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="添加剂总量上限"><InputNumber addonAfter="wt%" defaultValue={2} /></Form.Item>
                    <Form.Item label="优化目标"><Select style={{ width: 220 }} defaultValue="balanced" options={["balanced", "minimum friction", "minimum wear", "oxidation stability"].map((value) => ({ value, label: commonOptionLabels[value] ?? value }))} /></Form.Item>
                    <Button type="primary">运行配方设计模拟</Button>
                  </Form>
                  <Table
                    rowKey="key"
                    columns={[
                      { title: "推荐配方", dataIndex: "formulation" },
                      { title: "预测摩擦系数", dataIndex: "friction" },
                      { title: "预测磨斑直径", dataIndex: "wear" },
                      { title: "预测氧化温度", dataIndex: "oxidation" },
                      { title: "预测极压值", dataIndex: "ep" }
                    ]}
                    dataSource={formulationRows}
                    pagination={false}
                  />
                </div>
              )
            },
            {
              key: "ml-export",
              label: "机器学习数据集导出",
              children: (
                <Form layout="vertical">
                  <Form.Item label="目标性能">
                    <Select
                      mode="multiple"
                      defaultValue={["average_friction_coefficient"]}
                      options={[
                        { value: "average_friction_coefficient", label: "平均摩擦系数" },
                        { value: "wear_scar_diameter", label: "磨斑直径" },
                        { value: "initial_oxidation_temperature", label: "初始氧化温度" },
                        { value: "extreme_pressure_value", label: "极压值" }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="输入特征">
                    <Checkbox.Group
                      defaultValue={["molecule descriptors", "formulation composition"]}
                      options={[
                        { value: "molecule descriptors", label: "分子描述符" },
                        { value: "formulation composition", label: "配方组成" },
                        { value: "test conditions", label: "测试条件" }
                      ]}
                    />
                  </Form.Item>
                  <Button.Group>
                    <Button>导出仅描述符数据集</Button>
                    <Button>导出配方-性能数据集</Button>
                    <Button type="primary">导出完整机器学习数据集</Button>
                  </Button.Group>
                  <div style={{ marginTop: 12 }}>
                    <Tag color="green">RDKit 描述符</Tag>
                    <Tag>CSV 导出模拟</Tag>
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
