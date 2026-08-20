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
      title: "Name / Type",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.name}</span>
          <Tag>{row.preparationMethod || "No preparation method"}</Tag>
        </Space>
      )
    },
    { title: "Representative Molecule", dataIndex: "baseOil", render: (value) => value || "-" },
    {
      title: "Actions",
      width: 280,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelected(row)}>View</Button>
          <Button size="small" onClick={() => setExperimentDataFor(row)}>Experimental Data</Button>
          <Button size="small" onClick={() => message.info("Formulation editing will be added to the form in a future release.")}>Edit</Button>
          <Button size="small" danger onClick={() => confirmDelete(row)}>
            Delete
          </Button>
        </Space>
      )
    }
  ];

  function confirmDelete(row: Formulation) {
    Modal.confirm({
      title: "Delete this formulation?",
      content: row.name,
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const result = await deleteFormulation(row.id);
        if (!result.success && !result.deleted) {
          message.warning("The formulation record was not found.");
          return;
        }
        await refresh();
        if (selected?.id === row.id) setSelected(undefined);
        if (experimentDataFor?.id === row.id) setExperimentDataFor(undefined);
        message.success("Deleted from the data source.");
      }
    });
  }

  async function deleteExperiment(experimentId: string) {
    await deleteExperimentRecord(experimentId);
    await refresh();
    message.success("Experimental data deleted.");
  }

  async function saveExperimentCorrection(values: Record<string, unknown>) {
    if (!selectedExperiment) return;
    const result = await updateExperimentRecord(selectedExperiment.id, values);
    if (!result.success) {
      message.error("Failed to correct the experimental data.");
      return;
    }
    await refresh();
    setSelectedExperiment(result.experiment);
    setEditingExperiment(false);
    message.success("Experimental data corrected.");
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
        title="Formulation Library"
        description="Browse, compare, and copy lubricant formulations and review performance summaries."
        extra={
          <Button.Group>
            <Button>Copy</Button>
            <Button>Compare Selected</Button>
          </Button.Group>
        }
      />
      <Card>
        <div className="table-toolbar">
          <Input.Search placeholder="Search formulation names" value={search} onChange={(event) => setSearch(event.target.value)} />
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
        title="Complete Formulation Data"
        open={Boolean(selected)}
        onCancel={() => setSelected(undefined)}
        footer={<Button type="primary" onClick={() => setSelected(undefined)}>Close</Button>}
      >
        {selected && <FormulationDetails item={selected} />}
      </Modal>
      <Modal
        width={620}
        title={`${experimentDataFor?.name ?? ""} · Experimental Data`}
        open={Boolean(experimentDataFor)}
        onCancel={() => setExperimentDataFor(undefined)}
        footer={<Button type="primary" onClick={() => setExperimentDataFor(undefined)}>Close</Button>}
      >
        <Table
          size="small"
          rowKey="id"
          columns={[
            { title: "Test ID", dataIndex: "id" },
            { title: "Entered At", dataIndex: "createdAt" },
            {
              title: "Actions",
              width: 150,
              render: (_, row: Experiment) => (
                <Space size={6}>
                  <Button size="small" onClick={() => setSelectedExperiment(row)}>View</Button>
                  <Button size="small" danger onClick={() => deleteExperiment(row.id)}>
                    Delete
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
        title="Entered Experimental Data"
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
        <Descriptions.Item label="Name / Type">
          <Space size={6} wrap>
            <span>{item.name}</span>
            <Tag>{item.preparationMethod || "No preparation method"}</Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Representative Molecule / Base Oil">{item.baseOil || "-"}</Descriptions.Item>
        <Descriptions.Item label="Additive Count">{item.additiveCount}</Descriptions.Item>
        <Descriptions.Item label="Component Summary" span={2}>{item.componentsSummary || "-"}</Descriptions.Item>
        <Descriptions.Item label="Preparation Method">{item.preparationMethod || "-"}</Descriptions.Item>
        <Descriptions.Item label="Preparation Temperature">
          {item.preparationTemperature ?? "-"} {item.preparationTemperatureUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label="Preparation Time">
          {item.preparationTime ?? "-"} {item.preparationTimeUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label="Stability">{item.stabilityObservation || "-"}</Descriptions.Item>
        <Descriptions.Item label="Experiment Count">{item.experimentCount}</Descriptions.Item>
        <Descriptions.Item label="Best Average Friction Coefficient">{item.bestAverageFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Best Wear Scar Diameter">{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Highest Oxidation Temperature">{item.highestOxidationTemperature ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Notes" span={2}>{item.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="Created">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="Updated">{item.updatedAt}</Descriptions.Item>
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
      <Card size="small" title={`${item.id} · Correct Experimental Data`} className="detail-data-card">
        <Form layout="vertical" initialValues={initialValues} onFinish={onSave}>
          <div className="experiment-form-grid">
            <Form.Item label="Test Type" name="testType">
              <Select
                options={[
                  { value: "SRV", label: "SRV" },
                  { value: "four-ball", label: "Four-ball Test" },
                  { value: "ball-on-disk", label: "Ball-on-disk Test" },
                  { value: "PDSC", label: "PDSC" },
                  { value: "viscosity", label: "Viscosity Test" },
                  { value: "corrosion", label: "Corrosion Test" },
                  { value: "stability", label: "Stability Test" },
                  { value: "other", label: "Other" }
                ]}
              />
            </Form.Item>
            <Form.Item label="Test Standard" name="testStandard"><Input /></Form.Item>
            <Form.Item label="Instrument" name="instrument"><Input /></Form.Item>
            <Form.Item label="Upper Specimen Material" name="upperMaterial"><Input /></Form.Item>
            <Form.Item label="Lower Specimen Material" name="lowerMaterial"><Input /></Form.Item>
            <Form.Item label="Load" name="loadValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Temperature" name="temperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Duration" name="durationValue"><InputNumber addonAfter="min" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Average Friction Coefficient" name="averageFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Stable Friction Coefficient" name="stableFrictionCoefficient"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Wear Scar Diameter" name="wearScarDiameterValue"><InputNumber addonAfter="um" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Initial Oxidation Temperature" name="initialOxidationTemperatureValue"><InputNumber addonAfter="C" style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="Extreme-pressure Value" name="extremePressureValue"><InputNumber addonAfter="N" style={{ width: "100%" }} /></Form.Item>
          </div>
          <Space className="modal-action-row">
            <Button onClick={onCancelEdit}>Cancel</Button>
            <Button type="primary" htmlType="submit">Save Correction</Button>
          </Space>
        </Form>
      </Card>
    );
  }

  return (
    <Card size="small" title={`${item.id} · ${item.formulationName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="Test ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="Entered At">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="Formulation ID">{item.formulationId}</Descriptions.Item>
        <Descriptions.Item label="Formulation Name">{item.formulationName}</Descriptions.Item>
        <Descriptions.Item label="Test Type">{item.testType}</Descriptions.Item>
        <Descriptions.Item label="Test Standard">{item.testStandard || "-"}</Descriptions.Item>
        <Descriptions.Item label="Instrument">{item.instrument || "-"}</Descriptions.Item>
        <Descriptions.Item label="Upper Specimen Material">{item.upperMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label="Lower Specimen Material">{item.lowerMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label="Load">{item.loadValue ?? "-"} {item.loadUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="Temperature">{item.temperatureValue ?? "-"} {item.temperatureUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="Duration">{item.durationValue ?? "-"} {item.durationUnit ?? ""}</Descriptions.Item>
        <Descriptions.Item label="Experiment Date">{item.experimentDate || "-"}</Descriptions.Item>
        <Descriptions.Item label="Operator">{item.operator || "-"}</Descriptions.Item>
        <Descriptions.Item label="Average Friction Coefficient">{result?.averageFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Stable Friction Coefficient">{result?.stableFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Wear Scar Diameter">{result?.wearScarDiameterValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Initial Oxidation Temperature">{result?.initialOxidationTemperatureValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Extreme-pressure Value">{result?.extremePressureValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Repeat Count">{result?.repeatCount ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Notes" span={2}>{item.notes || result?.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="Updated">{item.updatedAt}</Descriptions.Item>
        <Descriptions.Item label="Performance Updated">{result?.updatedAt ?? "-"}</Descriptions.Item>
      </Descriptions>
      <Space className="modal-action-row">
        <Button onClick={onClose}>Close</Button>
        <Button type="primary" onClick={onEdit}>Correct</Button>
      </Space>
    </Card>
  );
}
