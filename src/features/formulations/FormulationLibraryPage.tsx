import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import { useLanguage } from "../../i18n/LanguageContext";
import {
  compareFormulations,
  copyFormulation,
  deleteExperimentRecord,
  deleteFormulation,
  listFormulationExperiments,
  listFormulationPage,
  updateExperimentRecord,
  updateFormulation
} from "../../lib/api";
import { useAsyncResource } from "../../lib/useAsyncResource";

/** How many formulations one page of the table holds. */
const PAGE_SIZE = 10;
import { reportDeletion } from "../../components/DeletionResultNotice";
import type { MessageKey } from "../../i18n/LanguageContext";
import type { Experiment, Formulation, PerformanceResult } from "../../types";
import { backendErrorText } from "../../lib/backendErrors";

export default function FormulationLibraryPage() {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Formulation>();
  const [experimentDataFor, setExperimentDataFor] = useState<Formulation>();
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment>();
  const [editingExperiment, setEditingExperiment] = useState(false);
  const [editing, setEditing] = useState<Formulation>();
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [copySource, setCopySource] = useState<Formulation>();
  const [copyName, setCopyName] = useState("");
  const [copying, setCopying] = useState(false);
  const [comparison, setComparison] = useState<Formulation[]>();
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState("");

  /**
   * One page of formulations, searched and counted in SQLite.
   *
   * This used to read every formulation, every experiment and every performance result on mount,
   * and then filter and paginate all three in the browser. The formulation list alone ran five
   * queries per row on the backend before it even reached the wire.
   *
   * The search term is a dependency, so typing re-reads the page — and the resource discards a
   * response that arrives after a newer one, which is exactly what typing produces.
   */
  const formulations = useAsyncResource(
    () => listFormulationPage({ page, pageSize: PAGE_SIZE, search }),
    [page, search]
  );

  /**
   * The experiments and results for the *selected* formulation only.
   *
   * Loading every experiment in the workspace to show the handful attached to one blend was the
   * other half of the same problem.
   */
  const experimentData = useAsyncResource(
    () =>
      experimentDataFor
        ? listFormulationExperiments(experimentDataFor.id)
        : Promise.resolve({ experiments: [], results: [] }),
    [experimentDataFor?.id]
  );

  const data = formulations.data?.items ?? [];

  async function refresh() {
    formulations.reload();
    experimentData.reload();
  }

  function openEdit(row: Formulation) {
    setEditing(row);
    editForm.setFieldsValue({
      name: row.name,
      preparationMethod: row.preparationMethod,
      preparationTemperature: row.preparationTemperature,
      preparationTime: row.preparationTime,
      stabilityObservation: row.stabilityObservation,
      notes: row.notes
    });
  }

  function startCopy() {
    const source = data.find((item) => item.id === selectedKeys[0]);
    if (!source) return;
    setCopySource(source);
    // A distinguishable default the user can rename before anything is written.
    setCopyName(`${source.name} ${t("ui.copySuffix")}`);
  }

  async function confirmCopy() {
    if (!copySource) return;
    if (!copyName.trim()) {
      message.warning(t("formulation.copyNameRequired"));
      return;
    }
    setCopying(true);
    try {
      const created = await copyFormulation(copySource.id, copyName);
      setCopySource(undefined);
      setSelectedKeys([created.id]);
      // The database is authoritative after a write.
      await refresh();
      message.success(`${t("formulation.copySucceeded")} ${created.name}`);
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setCopying(false);
    }
  }

  async function runComparison() {
    setComparing(true);
    setCompareError("");
    setComparison(undefined);
    try {
      // Re-read the selected rows so the comparison reflects the database, not the cached list.
      setComparison(await compareFormulations(selectedKeys.map(String)));
    } catch (error) {
      // Stored raw and translated at render, so a switch of language re-reads it.
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setComparing(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const values = await editForm.validateFields();
      await updateFormulation(editing.id, values);
      setEditing(undefined);
      // SQLite is authoritative after a write, so re-read instead of patching local state.
      await refresh();
      message.success(t("ui.formulationUpdated"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setSavingEdit(false);
    }
  }

  // The backend already applied the search and the page bounds; re-filtering here would hide rows
  // the database deliberately returned.
  const filtered = data;

  const columns: ColumnsType<Formulation> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: t("ui.nameType"),
      render: (_, row) => (
        <Space size={6} wrap>
          <span translate="no">{row.name}</span>
          <Tag>{row.preparationMethod || t("ui.noPreparationMethod")}</Tag>
        </Space>
      )
    },
    { title: t("ui.representativeMolecule"), dataIndex: "baseOil", render: (value) => value || "-" },
    {
      title: t("ui.actions"),
      width: 280,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelected(row)}>
            {t("ui.view")}
          </Button>
          <Button size="small" onClick={() => setExperimentDataFor(row)}>
            {t("ui.experimentalData")}
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            {t("ui.edit")}
          </Button>
          <Button size="small" danger onClick={() => confirmDelete(row)}>
            {t("ui.delete")}
          </Button>
        </Space>
      )
    }
  ];

  function confirmDelete(row: Formulation) {
    Modal.confirm({
      title: t("ui.deleteThisFormulation"),
      content: row.name,
      okText: t("ui.delete"),
      okButtonProps: { danger: true },
      cancelText: t("ui.cancel"),
      onOk: async () => {
        const result = await deleteFormulation(row.id);
        if (result.deleted) {
          await refresh();
          if (selected?.id === row.id) setSelected(undefined);
          if (experimentDataFor?.id === row.id) setExperimentDataFor(undefined);
        }
        // A formulation owns its own attachments and, through its experiments, theirs too.
        reportDeletion(result, t, "deletion.formulationDeleted");
      }
    });
  }

  async function deleteExperiment(experimentId: string) {
    const result = await deleteExperimentRecord(experimentId);
    if (result.deleted) await refresh();
    reportDeletion(result, t, "deletion.experimentDeleted");
  }

  async function saveExperimentCorrection(values: Record<string, unknown>) {
    if (!selectedExperiment) return;
    try {
      const updated = await updateExperimentRecord(selectedExperiment.id, values);
      // The database is authoritative: re-read rather than trusting local state.
      await refresh();
      setSelectedExperiment(updated);
      setEditingExperiment(false);
      message.success(t("ui.experimentalDataCorrected"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  // The experiments belonging to the selected blend, read for that blend rather than filtered out
  // of every experiment in the workspace.
  const formulationExperiments = experimentData.data?.experiments ?? [];
  const selectedExperimentResult = selectedExperiment
    ? (experimentData.data?.results ?? []).find((item) => item.experimentId === selectedExperiment.id)
    : undefined;

  return (
    <div className="page-grid table-page">
      <PageHeader
        title={t("ui.formulationLibrary")}
        description={t("ui.browseCompareAndCopyLubricantFormulationsAnd")}
        extra={
          <Space size={8}>
            <Button
              data-testid="copy-formulation"
              disabled={selectedKeys.length !== 1}
              title={selectedKeys.length === 1 ? undefined : t("formulation.copyHint")}
              onClick={startCopy}
            >
              {t("formulation.copy")}
            </Button>
            <Button
              data-testid="compare-formulations"
              loading={comparing}
              disabled={selectedKeys.length < 2}
              title={selectedKeys.length >= 2 ? undefined : t("formulation.compareHint")}
              onClick={runComparison}
            >
              {t("formulation.compare")}
            </Button>
          </Space>
        }
      />
      <Card>
        <div className="table-toolbar">
          <Input.Search
            placeholder={t("ui.searchFormulationNames")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          loading={formulations.loading}
          dataSource={filtered}
          tableLayout="fixed"
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            // The count SQLite reported, not the length of this page.
            total: formulations.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage
          }}
        />
      </Card>
      <Modal
        width={760}
        title={t("ui.completeFormulationData")}
        open={Boolean(selected)}
        onCancel={() => setSelected(undefined)}
        footer={
          <Button type="primary" onClick={() => setSelected(undefined)}>
            {t("ui.close")}
          </Button>
        }
      >
        {selected && <FormulationDetails item={selected} />}
      </Modal>
      <Modal
        width={620}
        title={`${experimentDataFor?.name ?? ""} · ${t("ui.experimentalData")}`}
        open={Boolean(experimentDataFor)}
        onCancel={() => setExperimentDataFor(undefined)}
        footer={
          <Button type="primary" onClick={() => setExperimentDataFor(undefined)}>
            {t("ui.close")}
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="id"
          columns={[
            { title: t("ui.testId"), dataIndex: "id" },
            { title: t("ui.enteredAt"), dataIndex: "createdAt" },
            {
              title: t("ui.actions"),
              width: 150,
              render: (_, row: Experiment) => (
                <Space size={6}>
                  <Button size="small" onClick={() => setSelectedExperiment(row)}>
                    {t("ui.view")}
                  </Button>
                  <Button size="small" danger onClick={() => deleteExperiment(row.id)}>
                    {t("ui.delete")}
                  </Button>
                </Space>
              )
            }
          ]}
          loading={experimentData.loading}
          dataSource={formulationExperiments}
          pagination={{ pageSize: 5, showSizeChanger: false }}
        />
      </Modal>
      <Modal
        width={780}
        title={t("ui.enteredExperimentalData")}
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
      <Modal
        width={640}
        title={t("ui.editFormulation")}
        open={Boolean(editing)}
        confirmLoading={savingEdit}
        onCancel={() => setEditing(undefined)}
        onOk={saveEdit}
        okText={t("ui.save")}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            label={t("ui.name")}
            name="name"
            rules={[{ required: true, message: t("ui.enterAFormulationName") }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label={t("ui.preparationMethod")} name="preparationMethod">
            <Input />
          </Form.Item>
          <Space size={12} wrap>
            <Form.Item label={t("ui.preparationTemperature")} name="preparationTemperature">
              <InputNumber min={-100} precision={2} />
            </Form.Item>
            <Form.Item label={t("ui.preparationTime")} name="preparationTime">
              <InputNumber min={0} precision={2} />
            </Form.Item>
          </Space>
          <Form.Item label={t("ui.stabilityObservation")} name="stabilityObservation">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label={t("ui.notes")} name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("formulation.copyTitle")}
        open={Boolean(copySource)}
        confirmLoading={copying}
        okText={t("formulation.copyAction")}
        onCancel={() => setCopySource(undefined)}
        onOk={confirmCopy}
      >
        <Typography.Paragraph type="secondary">{t("formulation.copyExplanation")}</Typography.Paragraph>
        <Typography.Text>{t("formulation.copyNameLabel")}</Typography.Text>
        <Input
          data-testid="copy-name"
          value={copyName}
          onChange={(event) => setCopyName(event.target.value)}
          onPressEnter={confirmCopy}
        />
      </Modal>

      <Modal
        width={960}
        title={t("formulation.compareTitle")}
        open={Boolean(comparison) || Boolean(compareError) || comparing}
        footer={null}
        onCancel={() => {
          setComparison(undefined);
          setCompareError("");
        }}
      >
        {comparing ? <LoadingBlock /> : null}
        {compareError ? (
          <Alert
            type="error"
            showIcon
            message={t("formulation.compareFailed")}
            description={backendErrorText(compareError, t)}
          />
        ) : null}
        {comparison && comparison.length > 0 ? (
          <Table
            size="small"
            rowKey="field"
            pagination={false}
            scroll={{ x: true }}
            dataSource={comparisonRows(comparison, t)}
            columns={[
              { title: t("formulation.field"), dataIndex: "field", width: 220, fixed: "left" as const },
              ...comparison.map((item, index) => ({
                title: <span translate="no">{item.name}</span>,
                dataIndex: `value${index}`,
                render: (value: string) => <span translate="no">{value}</span>
              }))
            ]}
          />
        ) : null}
        {comparison && comparison.length === 0 ? <Empty description={t("formulation.compareEmpty")} /> : null}
      </Modal>
    </div>
  );
}
function FormulationDetails({ item }: { item: Formulation }) {
  const { t } = useLanguage();
  return (
    <Card size="small" title={`${item.id} · ${item.name}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label={t("ui.nameType")}>
          <Space size={6} wrap>
            <span>{item.name}</span>
            <Tag>{item.preparationMethod || t("ui.noPreparationMethod")}</Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.representativeMoleculeBaseOil")}>{item.baseOil || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.additiveCount")}>{item.additiveCount}</Descriptions.Item>
        <Descriptions.Item label={t("ui.componentSummary")} span={2}>
          {item.componentsSummary || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.preparationMethod")}>{item.preparationMethod || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.preparationTemperature")}>
          {item.preparationTemperature ?? "-"} {item.preparationTemperatureUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.preparationTime")}>
          {item.preparationTime ?? "-"} {item.preparationTimeUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.stability")}>{item.stabilityObservation || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.experimentCount")}>{item.experimentCount}</Descriptions.Item>
        <Descriptions.Item label={t("ui.bestAverageFrictionCoefficient")}>
          {item.bestAverageFrictionCoefficient ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.bestWearScarDiameter")}>{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.highestOxidationTemperature")}>
          {item.highestOxidationTemperature ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.notes")} span={2}>
          {item.notes || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.created")}>{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.updated")}>{item.updatedAt}</Descriptions.Item>
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
  const { t } = useLanguage();
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
      <Card size="small" title={`${item.id} · ${t("ui.correctExperimentalData")}`} className="detail-data-card">
        <Form layout="vertical" initialValues={initialValues} onFinish={onSave}>
          <div className="experiment-form-grid">
            <Form.Item label={t("ui.testType")} name="testType">
              <Select
                options={[
                  { value: "SRV", label: "SRV" },
                  { value: "four-ball", label: t("ui.fourBallTest") },
                  { value: "ball-on-disk", label: t("ui.ballOnDiskTest") },
                  { value: "PDSC", label: "PDSC" },
                  { value: "viscosity", label: t("ui.viscosityTest") },
                  { value: "corrosion", label: t("ui.corrosionTest") },
                  { value: "stability", label: t("ui.stabilityTest") },
                  { value: "other", label: t("ui.other") }
                ]}
              />
            </Form.Item>
            <Form.Item label={t("ui.testStandard")} name="testStandard">
              <Input />
            </Form.Item>
            <Form.Item label={t("ui.instrument")} name="instrument">
              <Input />
            </Form.Item>
            <Form.Item label={t("ui.upperSpecimenMaterial")} name="upperMaterial">
              <Input />
            </Form.Item>
            <Form.Item label={t("ui.lowerSpecimenMaterial")} name="lowerMaterial">
              <Input />
            </Form.Item>
            <Form.Item label={t("ui.load")} name="loadValue">
              <InputNumber addonAfter="N" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.temperature")} name="temperatureValue">
              <InputNumber addonAfter="C" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.duration")} name="durationValue">
              <InputNumber addonAfter="min" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.averageFrictionCoefficient")} name="averageFrictionCoefficient">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.stableFrictionCoefficient")} name="stableFrictionCoefficient">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.wearScarDiameter")} name="wearScarDiameterValue">
              <InputNumber addonAfter="um" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.initialOxidationTemperature")} name="initialOxidationTemperatureValue">
              <InputNumber addonAfter="C" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("ui.extremePressureValue")} name="extremePressureValue">
              <InputNumber addonAfter="N" style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Space className="modal-action-row">
            <Button onClick={onCancelEdit}>{t("ui.cancel")}</Button>
            <Button type="primary" htmlType="submit">
              {t("ui.saveCorrection")}
            </Button>
          </Space>
        </Form>
      </Card>
    );
  }

  return (
    <Card size="small" title={`${item.id} · ${item.formulationName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label={t("ui.testId")}>{item.id}</Descriptions.Item>
        <Descriptions.Item label={t("ui.enteredAt")}>{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationId")}>{item.formulationId}</Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationName")}>{item.formulationName}</Descriptions.Item>
        <Descriptions.Item label={t("ui.testType")}>{item.testType}</Descriptions.Item>
        <Descriptions.Item label={t("ui.testStandard")}>{item.testStandard || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.instrument")}>{item.instrument || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.upperSpecimenMaterial")}>{item.upperMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.lowerSpecimenMaterial")}>{item.lowerMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.load")}>
          {item.loadValue ?? "-"} {item.loadUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.temperature")}>
          {item.temperatureValue ?? "-"} {item.temperatureUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.duration")}>
          {item.durationValue ?? "-"} {item.durationUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.experimentDate")}>{item.experimentDate || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.operator")}>{item.operator || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.averageFrictionCoefficient")}>
          {result?.averageFrictionCoefficient ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.stableFrictionCoefficient")}>
          {result?.stableFrictionCoefficient ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.wearScarDiameter")}>{result?.wearScarDiameterValue ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.initialOxidationTemperature")}>
          {result?.initialOxidationTemperatureValue ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.extremePressureValue")}>
          {result?.extremePressureValue ?? "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.repeatCount")}>{result?.repeatCount ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.notes")} span={2}>
          {item.notes || result?.notes || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.updated")}>{item.updatedAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.performanceUpdated")}>{result?.updatedAt ?? "-"}</Descriptions.Item>
      </Descriptions>
      <Space className="modal-action-row">
        <Button onClick={onClose}>{t("ui.close")}</Button>
        <Button type="primary" onClick={onEdit}>
          {t("ui.correct")}
        </Button>
      </Space>
    </Card>
  );
}

/** Flattens the selected formulations into one row per compared field. */
function comparisonRows(formulations: Formulation[], t: (key: MessageKey) => string) {
  const missing = t("formulation.notRecorded");
  const number = (value: number | null | undefined, unit = "") =>
    value === null || value === undefined ? missing : `${value}${unit ? ` ${unit}` : ""}`;
  const components = (item: Formulation, role: string) => {
    const matched = (item.components ?? []).filter((component) => component.componentRole === role);
    if (matched.length === 0) return missing;
    return matched
      .map((component) => {
        const label =
          component.additiveName ||
          component.baseOilName ||
          component.moleculeName ||
          component.additiveId ||
          component.baseOilId ||
          component.moleculeId ||
          t("formulation.unnamedComponent");
        const amount =
          component.concentrationValue === null || component.concentrationValue === undefined
            ? missing
            : `${component.concentrationValue} ${component.concentrationUnit || ""}`.trim();
        return `${label}: ${amount}`;
      })
      .join("; ");
  };

  const fields: { field: string; read: (item: Formulation) => string }[] = [
    { field: t("formulation.name"), read: (item) => item.name },
    { field: t("formulation.baseOil"), read: (item) => item.baseOil || missing },
    { field: t("formulation.baseOilComponents"), read: (item) => components(item, "base_oil") },
    { field: t("formulation.additives"), read: (item) => components(item, "additive") },
    { field: t("formulation.additiveCount"), read: (item) => String(item.additiveCount ?? 0) },
    { field: t("formulation.preparationMethod"), read: (item) => item.preparationMethod || missing },
    {
      field: t("formulation.preparationTemperature"),
      read: (item) => number(item.preparationTemperature, item.preparationTemperatureUnit)
    },
    {
      field: t("formulation.preparationTime"),
      read: (item) => number(item.preparationTime, item.preparationTimeUnit)
    },
    { field: t("formulation.stability"), read: (item) => item.stabilityObservation || missing },
    { field: t("formulation.experimentCount"), read: (item) => String(item.experimentCount ?? 0) },
    { field: t("formulation.bestFriction"), read: (item) => number(item.bestAverageFrictionCoefficient) },
    { field: t("formulation.bestWear"), read: (item) => number(item.bestWearScarDiameter, "um") },
    { field: t("formulation.bestOxidation"), read: (item) => number(item.highestOxidationTemperature, "C") },
    { field: t("formulation.bestExtremePressure"), read: (item) => number(item.bestExtremePressureValue, "N") }
  ];

  return fields.map((entry) => {
    const row: Record<string, string> = { field: entry.field };
    formulations.forEach((item, index) => {
      row[`value${index}`] = entry.read(item);
    });
    return row;
  });
}
