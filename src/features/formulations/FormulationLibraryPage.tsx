import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import {
  deleteExperimentRecord,
  deleteFormulation,
  listExperiments,
  listFormulations,
  listPerformanceResults,
  updateExperimentRecord
} from "../../lib/api";
import type { Experiment, Formulation, PerformanceResult } from "../../types";

export default function FormulationLibraryPage() {
  const [data, setData] = useState<Formulation[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [performanceResults, setPerformanceResults] = useState<PerformanceResult[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Formulation>();
  const [experimentDataFor, setExperimentDataFor] = useState<Formulation>();
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment>();
  const [editingExperiment, setEditingExperiment] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setData(await listFormulations());
    setExperiments(await listExperiments());
    setPerformanceResults(await listPerformanceResults());
  }

  const filtered = useMemo(
    () => data.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    [data, search]
  );

  const columns: ColumnsType<Formulation> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "名称类型",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.name}</span>
          <Tag>{row.preparationMethod || "未设置制备方法"}</Tag>
        </Space>
      )
    },
    { title: "代表分子", dataIndex: "baseOil", render: (value) => value || "-" },
    {
      title: "操作",
      width: 280,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelected(row)}>查看</Button>
          <Button size="small" onClick={() => setExperimentDataFor(row)}>实验数据</Button>
          <Button size="small" onClick={() => message.info("编辑配方功能将在下一阶段接入表单。")}>编辑</Button>
          <Button size="small" danger onClick={() => confirmDelete(row)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  function confirmDelete(row: Formulation) {
    Modal.confirm({
      title: "确认删除配方？",
      content: row.name,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const result = await deleteFormulation(row.id);
        if (!result.success && !result.deleted) {
          message.warning("未找到需要删除的配方记录。");
          return;
        }
        await refresh();
        if (selected?.id === row.id) setSelected(undefined);
        if (experimentDataFor?.id === row.id) setExperimentDataFor(undefined);
        message.success("已从数据源删除。");
      }
    });
  }

  async function deleteExperiment(experimentId: string) {
    await deleteExperimentRecord(experimentId);
    await refresh();
    message.success("实验数据已删除。");
  }

  async function saveExperimentCorrection(values: Record<string, unknown>) {
    if (!selectedExperiment) return;
    const result = await updateExperimentRecord(selectedExperiment.id, values);
    if (!result.success) {
      message.error("实验数据修正失败。");
      return;
    }
    await refresh();
    setSelectedExperiment(result.experiment);
    setEditingExperiment(false);
    message.success("实验数据已修正。");
  }

  const formulationExperiments = experimentDataFor
    ? experiments.filter((item) => item.formulationId === experimentDataFor.id)
    : [];
  const selectedExperimentResult = selectedExperiment
    ? performanceResults.find((item) => item.experimentId === selectedExperiment.id)
    : undefined;

  return (
    <div className="page-grid table-page">
      <PageHeader
        title="配方库"
        description="浏览、比较和复制润滑配方，并查看性能摘要。"
        extra={
          <Button.Group>
            <Button>复制</Button>
            <Button>比较所选</Button>
          </Button.Group>
        }
      />
      <Card>
        <div className="table-toolbar">
          <Input.Search placeholder="搜索配方名称" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          tableLayout="fixed"
          pagination={{ pageSize: 7, showSizeChanger: false }}
        />
      </Card>
      <Modal
        width={760}
        title="配方完整数据"
        open={Boolean(selected)}
        onCancel={() => setSelected(undefined)}
        footer={<Button type="primary" onClick={() => setSelected(undefined)}>关闭</Button>}
      >
        {selected && <FormulationDetails item={selected} />}
      </Modal>
      <Modal
        width={620}
        title={`${experimentDataFor?.name ?? ""} · 实验数据`}
        open={Boolean(experimentDataFor)}
        onCancel={() => setExperimentDataFor(undefined)}
        footer={<Button type="primary" onClick={() => setExperimentDataFor(undefined)}>关闭</Button>}
      >
        <Table
          size="small"
          rowKey="id"
          columns={[
            { title: "试验ID", dataIndex: "id" },
            { title: "录入时间", dataIndex: "createdAt" },
            {
              title: "操作",
              width: 150,
              render: (_, row: Experiment) => (
                <Space size={6}>
                  <Button size="small" onClick={() => setSelectedExperiment(row)}>查看</Button>
                  <Button size="small" danger onClick={() => deleteExperiment(row.id)}>
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
          dataSource={formulationExperiments}
          pagination={{ pageSize: 5, showSizeChanger: false }}
        />
      </Modal>
      <Modal
        width={780}
        title="实验录入数据"
        open={Boolean(selectedExperiment)}
        onCancel={() => {
          setSelectedExperiment(undefined);
          setEditingExperiment(false);
        }}
        footer={null}
      >
        {selectedExperiment && (
          <ExperimentRecordedDetails
            item={selectedExperiment}
            result={selectedExperimentResult}
            editing={editingExperiment}
            onEdit={() => setEditingExperiment(true)}
            onCancelEdit={() => setEditingExperiment(false)}
            onClose={() => {
              setSelectedExperiment(undefined);
              setEditingExperiment(false);
            }}
            onSave={saveExperimentCorrection}
          />
        )}
      </Modal>
    </div>
  );
}

function FormulationDetails({ item }: { item: Formulation }) {
  return (
    <Card size="small" title={`${item.id} · ${item.name}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="名称类型">
          <Space size={6} wrap>
            <span>{item.name}</span>
            <Tag>{item.preparationMethod || "未设置制备方法"}</Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="代表分子/基础油">{item.baseOil || "-"}</Descriptions.Item>
        <Descriptions.Item label="添加剂数量">{item.additiveCount}</Descriptions.Item>
        <Descriptions.Item label="组分摘要" span={2}>{item.componentsSummary || "-"}</Descriptions.Item>
        <Descriptions.Item label="制备方法">{item.preparationMethod || "-"}</Descriptions.Item>
        <Descriptions.Item label="制备温度">
          {item.preparationTemperature ?? "-"} {item.preparationTemperatureUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label="制备时间">
          {item.preparationTime ?? "-"} {item.preparationTimeUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label="稳定性">{item.stabilityObservation || "-"}</Descriptions.Item>
        <Descriptions.Item label="实验数量">{item.experimentCount}</Descriptions.Item>
        <Descriptions.Item label="最佳平均摩擦系数">{item.bestAverageFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="最佳磨斑直径">{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="最高氧化温度">{item.highestOxidationTemperature ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{item.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function ExperimentRecordedDetails({
  item,
  result,
  editing,
  onEdit,
  onCancelEdit,
  onClose,
  onSave
}: {
  item: Experiment;
  result?: PerformanceResult;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const initialValues = {
    testType: item.testType,
    testStandard: item.testStandard,
    instrument: item.instrument,
    upperMaterial: item.upperMaterial,
    lowerMaterial: item.lowerMaterial,
    loadValue: item.loadValue,
    temperatureValue: item.temperatureValue,
    durationValue: item.durationValue,
    averageFrictionCoefficient: result?.averageFrictionCoefficient,
    stableFrictionCoefficient: result?.stableFrictionCoefficient,
    wearScarDiameterValue: result?.wearScarDiameterValue,
    initialOxidationTemperatureValue: result?.initialOxidationTemperatureValue,
    extremePressureValue: result?.extremePressureValue
  };

  if (editing) {
    return (
      <Card size="small" title={`${item.id} · 修正实验数据`} className="detail-data-card">
        <Form layout="vertical" initialValues={initialValues} onFinish={onSave}>
          <div className="experiment-form-grid">
            <Form.Item label="测试类型" name="testType">
              <Select
                options={[
                  { value: "SRV", label: "SRV" },
                  { value: "四球试验", label: "四球试验" },
                  { value: "球盘试验", label: "球盘试验" },
                  { value: "PDSC", label: "PDSC" },
                  { value: "黏度测试", label: "黏度测试" },
                  { value: "corrosion", label: "腐蚀测试" },
                  { value: "stability", label: "稳定性测试" },
                  { value: "other", label: "其他" }
                ]}
              />
            </Form.Item>
            <Form.Item label="测试标准" name="testStandard"><Input /></Form.Item>
            <Form.Item label="仪器" name="instrument"><Input /></Form.Item>
            <Form.Item label="上试样材料" name="upperMaterial"><Input /></Form.Item>
            <Form.Item label="下试样材料" name="lowerMaterial"><Input /></Form.Item>
            <Form.Item label="载荷" name="loadValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="温度" name="temperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="时长" name="durationValue"><InputNumber addonAfter="min" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="平均摩擦系数" name="averageFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="稳定摩擦系数" name="stableFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="磨斑直径" name="wearScarDiameterValue"><InputNumber addonAfter="um" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="初始氧化温度" name="initialOxidationTemperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="极压值" name="extremePressureValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
          </div>
          <Space className="modal-action-row">
            <Button onClick={onCancelEdit}>取消</Button>
            <Button type="primary" htmlType="submit">保存修正</Button>
          </Space>
        </Form>
      </Card>
    );
  }

  return (
    <Card size="small" title={`${item.id} · ${item.formulationName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="试验ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="录入时间">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="配方 ID">{item.formulationId}</Descriptions.Item>
        <Descriptions.Item label="配方名称">{item.formulationName}</Descriptions.Item>
        <Descriptions.Item label="测试类型">{item.testType}</Descriptions.Item>
        <Descriptions.Item label="测试标准">{item.testStandard || "-"}</Descriptions.Item>
        <Descriptions.Item label="仪器">{item.instrument || "-"}</Descriptions.Item>
        <Descriptions.Item label="上试样材料">{item.upperMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label="下试样材料">{item.lowerMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label="载荷">{item.loadValue ?? "-"} {item.loadUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="温度">{item.temperatureValue ?? "-"} {item.temperatureUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="时长">{item.durationValue ?? "-"} {item.durationUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="实验日期">{item.experimentDate || "-"}</Descriptions.Item>
        <Descriptions.Item label="操作者">{item.operator || "-"}</Descriptions.Item>
        <Descriptions.Item label="平均摩擦系数">{result?.averageFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="稳定摩擦系数">{result?.stableFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="磨斑直径">{result?.wearScarDiameterValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="初始氧化温度">{result?.initialOxidationTemperatureValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="极压值">{result?.extremePressureValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="重复次数">{result?.repeatCount ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{item.notes || result?.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{item.updatedAt}</Descriptions.Item>
        <Descriptions.Item label="性能更新时间">{result?.updatedAt ?? "-"}</Descriptions.Item>
      </Descriptions>
      <Space className="modal-action-row">
        <Button onClick={onClose}>关闭</Button>
        <Button type="primary" onClick={onEdit}>修正</Button>
      </Space>
    </Card>
  );
}
