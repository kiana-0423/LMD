import PagedModal from "../../components/PagedModal";
import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Tabs, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import AsyncBoundary from "../../components/AsyncBoundary";
import BlockedDeletionDialog from "../../components/BlockedDeletionDialog";
import MoleculePicker from "../../components/MoleculePicker";
import PageHeader from "../../components/PageHeader";
import {
  createAdditive,
  createBaseOil,
  deleteAdditive,
  deleteAdditiveWithComponents,
  deleteBaseOil,
  deleteBaseOilWithComponents,
  listAdditivePage,
  listBaseOilPage,
  updateAdditive,
  updateBaseOil
} from "../../lib/api";
import { additiveFunctionLabelKeys, additiveFunctionTags } from "../../lib/constants";
import type { Additive, BaseOil, DeletionOutcome } from "../../types";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";

/** How many rows one page of either table holds. */
const PAGE_SIZE = 25;

type LibraryTab = "base-oils" | "additives";

export default function BaseAdditiveLibraryPage() {
  const { t } = useLanguage();
  const [baseOilForm] = Form.useForm();
  const [additiveForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState<LibraryTab>("base-oils");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // Set while the modal edits an existing record; cleared for a new one.
  const [editingId, setEditingId] = useState<string>();
  const [selectedBaseOil, setSelectedBaseOil] = useState<BaseOil>();
  const [selectedAdditive, setSelectedAdditive] = useState<Additive>();
  /** The refused delete, with what it would take to force it through. */
  const [blocked, setBlocked] = useState<{
    outcome: DeletionOutcome;
    name: string;
    id: string;
    kind: LibraryTab;
  }>();

  // Server-side paging. The tables used to load every base oil and every additive on mount, and
  // then render twenty-five of them.
  const [baseOilPage, setBaseOilPage] = useState(1);
  const [additivePage, setAdditivePage] = useState(1);
  const baseOils = useAsyncResource(
    () => listBaseOilPage({ page: baseOilPage, pageSize: PAGE_SIZE }),
    [baseOilPage]
  );
  const additives = useAsyncResource(
    () => listAdditivePage({ page: additivePage, pageSize: PAGE_SIZE }),
    [additivePage]
  );

  async function refresh() {
    baseOils.reload();
    additives.reload();
  }

  function openEditModal(tab: LibraryTab, record: BaseOil | Additive) {
    setActiveTab(tab);
    setEditingId(record.id);
    if (tab === "base-oils") {
      const baseOil = record as BaseOil;
      baseOilForm.setFieldsValue({
        name: baseOil.name,
        baseOilType: baseOil.baseOilType,
        representativeMoleculeId: baseOil.representativeMoleculeId || undefined,
        viscosity40c: baseOil.viscosity40c,
        viscosity100c: baseOil.viscosity100c,
        viscosityIndex: baseOil.viscosityIndex,
        density: baseOil.density,
        pourPoint: baseOil.pourPoint,
        flashPoint: baseOil.flashPoint,
        supplier: baseOil.supplier,
        batchNumber: baseOil.batchNumber,
        notes: baseOil.notes
      });
    } else {
      const additive = record as Additive;
      additiveForm.setFieldsValue({
        moleculeId: additive.moleculeId,
        functionTypes: additive.functionTypes,
        activeElements: additive.activeElements,
        typicalConcentrationMin: additive.typicalConcentrationMin,
        typicalConcentrationMax: additive.typicalConcentrationMax,
        concentrationUnit: additive.concentrationUnit,
        compatibleBaseOils: additive.compatibleBaseOils,
        applicationNotes: additive.applicationNotes
      });
    }
    setCreateOpen(true);
  }

  function openCreateModal(tab: LibraryTab) {
    setActiveTab(tab);
    setEditingId(undefined);
    if (tab === "base-oils") {
      // Deliberately blank. The form used to open with "Group III" already filled in, which
      // records an API classification nobody made — and one that is wrong for most of the oils a
      // lab actually holds. A grade is a property of the oil, not of the form.
      baseOilForm.resetFields();
    } else {
      additiveForm.resetFields();
      // Empty lists, and the unit only. A unit is a label on a number the user is about to type
      // and is visible in the field beside it; a *value* would be a measurement nobody made.
      additiveForm.setFieldsValue({
        activeElements: [],
        compatibleBaseOils: [],
        concentrationUnit: "wt%",
        functionTypes: []
      });
    }
    setCreateOpen(true);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      if (activeTab === "base-oils") {
        const values = await baseOilForm.validateFields();
        if (editingId) {
          // Undefined is omitted by JSON; send an explicit clear when the picker is cleared.
          await updateBaseOil(editingId, { ...values, representativeMoleculeId: values.representativeMoleculeId ?? "" });
          message.success(t("ui.baseOilUpdated"));
        } else {
          await createBaseOil(values);
          message.success(t("ui.baseOilSaved"));
        }
      } else {
        const values = await additiveForm.validateFields();
        if (editingId) {
          await updateAdditive(editingId, values);
          message.success(t("ui.additiveUpdated"));
        } else {
          await createAdditive(values);
          message.success(t("ui.additiveSaved"));
        }
      }
      setCreateOpen(false);
      setEditingId(undefined);
      // Re-read from the database rather than patching local state.
      await refresh();
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setCreating(false);
    }
  }

  const baseOilOptions = (baseOils.data?.items ?? []).map((baseOil: BaseOil) => ({
    value: baseOil.name,
    label: baseOil.name
  }));
  const additiveFunctionOptions = additiveFunctionTags.map((value) => ({
    value,
    label: additiveFunctionLabelKeys[value] ? t(additiveFunctionLabelKeys[value]) : value
  }));

  const baseOilColumns: ColumnsType<BaseOil> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: t("ui.nameType"),
      render: (_, row) => (
        <Space size={6} wrap>
          <span translate="no">{row.name}</span>
          <Tag>{row.baseOilType}</Tag>
        </Space>
      )
    },
    { title: t("ui.representativeMolecule"), dataIndex: "representativeMoleculeId", render: (value) => value || "-" },
    {
      title: t("ui.actions"),
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedBaseOil(row)}>{t("ui.view")}</Button>
          <Button size="small" onClick={() => openEditModal("base-oils", row)}>{t("ui.edit")}</Button>
          <Button size="small" danger onClick={() => confirmDeleteBaseOil(row)}>{t("ui.delete")}</Button>
        </Space>
      )
    }
  ];

  const additiveColumns: ColumnsType<Additive> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: t("ui.nameType"),
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.moleculeName}</span>
          {row.functionTypes.map((value) => (
            <Tag key={value}>{additiveFunctionLabelKeys[value] ? t(additiveFunctionLabelKeys[value]) : value}</Tag>
          ))}
        </Space>
      )
    },
    { title: t("ui.representativeMolecule"), dataIndex: "moleculeId" },
    {
      title: t("ui.actions"),
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedAdditive(row)}>{t("ui.view")}</Button>
          <Button size="small" onClick={() => openEditModal("additives", row)}>{t("ui.edit")}</Button>
          <Button size="small" danger onClick={() => confirmDeleteAdditive(row)}>{t("ui.delete")}</Button>
        </Space>
      )
    }
  ];

  /**
   * Applies whatever the backend decided.
   *
   * Three outcomes, and the interface has to distinguish all three: the row is gone, the row was
   * never there, or the row is still in use and nothing was touched. The third used to be
   * impossible — the delete removed the referencing components instead — and it is the one this
   * function exists for.
   */
  async function applyDeletion(
    outcome: DeletionOutcome,
    row: { id: string; label: string },
    notFoundKey: MessageKey,
    clearSelection: () => void
  ) {
    if (outcome.blocked) {
      setBlocked({ outcome, name: row.label, id: row.id, kind: activeTab });
      return;
    }
    if (!outcome.success && !outcome.deleted) {
      message.warning(t(notFoundKey));
      return;
    }
    await refresh();
    clearSelection();
    if (outcome.removedComponents > 0) {
      message.warning(
        t("delete.cascadeDone", {
          components: outcome.removedComponents,
          formulations: outcome.blockedBy.length
        })
      );
    } else {
      message.success(t("ui.deletedFromTheDataSource"));
    }
  }

  function confirmDeleteBaseOil(row: BaseOil) {
    Modal.confirm({
      title: t("ui.deleteThisBaseOil"),
      content: row.name,
      okText: t("ui.delete"),
      okButtonProps: { danger: true },
      cancelText: t("ui.cancel"),
      onOk: async () => {
        const outcome = await deleteBaseOil(row.id);
        await applyDeletion(
          outcome,
          { id: row.id, label: row.name },
          "ui.theBaseOilRecordWasNotFound",
          () => {
            if (selectedBaseOil?.id === row.id) setSelectedBaseOil(undefined);
          }
        );
      }
    });
  }

  function confirmDeleteAdditive(row: Additive) {
    Modal.confirm({
      title: t("ui.deleteThisAdditive"),
      content: row.moleculeName,
      okText: t("ui.delete"),
      okButtonProps: { danger: true },
      cancelText: t("ui.cancel"),
      onOk: async () => {
        const outcome = await deleteAdditive(row.id);
        await applyDeletion(
          outcome,
          { id: row.id, label: row.moleculeName },
          "ui.theAdditiveRecordWasNotFound",
          () => {
            if (selectedAdditive?.id === row.id) setSelectedAdditive(undefined);
          }
        );
      }
    });
  }

  /** The explicit cascade, run only after the dialog's own acknowledgement. */
  const cascade = useAsyncAction(async () => {
    if (!blocked) return;
    const outcome =
      blocked.kind === "base-oils"
        ? await deleteBaseOilWithComponents(blocked.id)
        : await deleteAdditiveWithComponents(blocked.id);
    setBlocked(undefined);
    await applyDeletion(outcome, { id: blocked.id, label: blocked.name }, "ui.theBaseOilRecordWasNotFound", () => {
      if (selectedBaseOil?.id === blocked.id) setSelectedBaseOil(undefined);
      if (selectedAdditive?.id === blocked.id) setSelectedAdditive(undefined);
    });
  }, { onError: (error) => message.error(backendErrorText(error, t)) });

  return (
    <div className="page-grid table-page">
      <PageHeader
        title={t("ui.baseOilsAdditives")}
        description={t("ui.manageBaseOilsThatMayNotHaveSmiles")}
        extra={
          <Space wrap>
            <Button onClick={() => openCreateModal("base-oils")}>{t("ui.newBaseOil")}</Button>
            <Button type="primary" onClick={() => openCreateModal("additives")}>{t("ui.newAdditive")}</Button>
          </Space>
        }
      />
      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as LibraryTab)}
          items={[
            {
              key: "base-oils",
              label: t("ui.baseOils"),
              children: (
                <AsyncBoundary
                  loading={baseOils.loading && !baseOils.data}
                  error={baseOils.error}
                  onRetry={baseOils.reload}
                >
                  <Table
                    size="small"
                    rowKey="id"
                    columns={baseOilColumns}
                    dataSource={baseOils.data?.items ?? []}
                    tableLayout="fixed"
                    loading={baseOils.loading}
                    // `total` is the count SQLite reported, not the length of this page: the pager
                    // has to know how many rows exist, and only one page of them is here.
                    pagination={{
                      current: baseOilPage,
                      pageSize: PAGE_SIZE,
                      total: baseOils.data?.total ?? 0,
                      showSizeChanger: false,
                      onChange: setBaseOilPage
                    }}
                  />
                </AsyncBoundary>
              )
            },
            {
              key: "additives",
              label: t("ui.additives"),
              children: (
                <AsyncBoundary
                  loading={additives.loading && !additives.data}
                  error={additives.error}
                  onRetry={additives.reload}
                >
                  <Table
                    size="small"
                    rowKey="id"
                    columns={additiveColumns}
                    dataSource={additives.data?.items ?? []}
                    tableLayout="fixed"
                    loading={additives.loading}
                    pagination={{
                      current: additivePage,
                      pageSize: PAGE_SIZE,
                      total: additives.data?.total ?? 0,
                      showSizeChanger: false,
                      onChange: setAdditivePage
                    }}
                  />
                </AsyncBoundary>
              )
            }
          ]}
        />
      </Card>
      <BlockedDeletionDialog
        outcome={blocked?.outcome}
        recordName={blocked?.name ?? ""}
        cascading={cascade.running}
        onClose={() => setBlocked(undefined)}
        onCascade={() => void cascade.run()}
      />
      <Modal
        centered
        className="catalogue-editor-modal"
        width={880}
        title={
          editingId
            ? activeTab === "base-oils"
              ? t("ui.editBaseOil"): t("ui.editAdditive"): activeTab === "base-oils"
              ? t("ui.newBaseOil"): t("ui.newAdditive")}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setEditingId(undefined);
        }}
        onOk={handleCreate}
        confirmLoading={creating}
        okText={t("ui.save")}
        cancelText={t("ui.cancel")}
      >
        {activeTab === "base-oils" ? (
          <Form form={baseOilForm} layout="vertical" size="small" className="catalogue-editor-form">
            <Form.Item className="catalogue-editor-wide" label={t("ui.representativeMolecule")} name="representativeMoleculeId">
              <MoleculePicker allowClear placeholder={t("ui.selectABaseOilMoleculeFromTheLibrary")} />
            </Form.Item>
            <Form.Item label={t("ui.name")} name="name" rules={[{ required: true, message: t("ui.enterABaseOilName") }]}>
              <Input placeholder={t("ui.examplePao6")} />
            </Form.Item>
            <Form.Item label={t("ui.baseOilType")} name="baseOilType">
              <Input placeholder={t("ui.exampleGroupIiiPaoEster")} />
            </Form.Item>
            <div className="catalogue-property-grid">
              <Form.Item label={t("ui.viscosityAt40C")} name="viscosity40c">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label={t("ui.viscosityAt100C")} name="viscosity100c">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label={t("ui.viscosityIndex")} name="viscosityIndex">
                <InputNumber precision={1} />
              </Form.Item>
              <Form.Item label={t("ui.density")} name="density">
                <InputNumber min={0} precision={4} />
              </Form.Item>
              <Form.Item label={t("ui.pourPoint")} name="pourPoint">
                <InputNumber precision={1} />
              </Form.Item>
              <Form.Item label={t("ui.flashPoint")} name="flashPoint">
                <InputNumber precision={1} />
              </Form.Item>
            </div>
            <Form.Item label={t("ui.supplier")} name="supplier">
              <Input />
            </Form.Item>
            <Form.Item label={t("ui.batch")} name="batchNumber">
              <Input />
            </Form.Item>
            <Form.Item className="catalogue-editor-wide" label={t("ui.notes")} name="notes">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        ) : (
          <Form form={additiveForm} layout="vertical" size="small" className="catalogue-editor-form">
            <Form.Item className="catalogue-editor-wide" label={t("ui.representativeMolecule")} name="moleculeId" rules={[{ required: true, message: t("ui.selectARepresentativeMolecule") }]}>
              <MoleculePicker placeholder={t("ui.selectAnAdditiveMoleculeFromTheLibrary")} />
            </Form.Item>
            <Form.Item label={t("ui.functionTypes")} name="functionTypes">
              <Select maxTagCount="responsive" mode="multiple" options={additiveFunctionOptions} />
            </Form.Item>
            <Form.Item label={t("ui.activeElements")} name="activeElements">
              <Select maxTagCount="responsive" mode="tags" options={["C", "H", "O", "N", "S", "P", "Zn", "Mo", "B", "Cl"].map((value) => ({ value, label: value }))} />
            </Form.Item>
            <div className="catalogue-property-grid">
              <Form.Item label={t("ui.minimumTypicalConcentration")} name="typicalConcentrationMin">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label={t("ui.maximumTypicalConcentration")} name="typicalConcentrationMax">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label={t("ui.concentrationUnit")} name="concentrationUnit">
                <Input placeholder="wt%" />
              </Form.Item>
            </div>
            <Form.Item className="catalogue-editor-wide" label={t("ui.compatibleBaseOils")} name="compatibleBaseOils">
              <Select maxTagCount="responsive" mode="tags" options={baseOilOptions} placeholder={t("ui.enterOrSelectExistingBaseOilNames")} />
            </Form.Item>
            <Form.Item className="catalogue-editor-wide" label={t("ui.applicationNotes")} name="applicationNotes">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <PagedModal
        width={760}
        title={t("ui.completeBaseOilData")}
        open={Boolean(selectedBaseOil)}
        onCancel={() => setSelectedBaseOil(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedBaseOil(undefined)}>{t("ui.close")}</Button>}
      >
        {selectedBaseOil && <BaseOilDetails item={selectedBaseOil} />}
      </PagedModal>
      <PagedModal
        width={760}
        title={t("ui.completeAdditiveData")}
        open={Boolean(selectedAdditive)}
        onCancel={() => setSelectedAdditive(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedAdditive(undefined)}>{t("ui.close")}</Button>}
      >
        {selectedAdditive && <AdditiveDetails item={selectedAdditive} />}
      </PagedModal>
    </div>
  );
}

function BaseOilDetails({ item }: { item: BaseOil }) {
  const { t } = useLanguage();
  return (
    <Card size="small" title={<span translate="no">{`${item.id} · ${item.name}`}</span>} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label={t("ui.nameType")}>{item.name} / {item.baseOilType}</Descriptions.Item>
        <Descriptions.Item label={t("ui.representativeMolecule")}>{item.representativeMoleculeId || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.supplier")}><span translate="no">{item.supplier || "-"}</span></Descriptions.Item>
        <Descriptions.Item label={t("ui.viscosityAt40C")}>{item.viscosity40c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.viscosityAt100C")}>{item.viscosity100c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.viscosityIndex")}>{item.viscosityIndex ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.density")}>{item.density ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.pourPoint")}>{item.pourPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.flashPoint")}>{item.flashPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.batch")}><span translate="no">{item.batchNumber || "-"}</span></Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationCount")}>{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label={t("ui.notes")} span={2}><span translate="no">{item.notes || "-"}</span></Descriptions.Item>
        <Descriptions.Item label={t("ui.created")}>{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.updated")}>{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function AdditiveDetails({ item }: { item: Additive }) {
  const { t } = useLanguage();
  return (
    <Card size="small" title={`${item.id} · ${item.moleculeName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label={t("ui.nameType")}>
          <Space size={4} wrap>
            <span translate="no">{item.moleculeName}</span>
            {item.functionTypes.map((value) => (
              <Tag key={value}>{additiveFunctionLabelKeys[value] ? t(additiveFunctionLabelKeys[value]) : value}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.representativeMolecule")}>{item.moleculeId}</Descriptions.Item>
        <Descriptions.Item label={t("ui.activeElements")}>{item.activeElements.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.typicalConcentration")}>
          {item.typicalConcentrationMin}-{item.typicalConcentrationMax} {item.concentrationUnit}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.compatibleBaseOils")}>{item.compatibleBaseOils.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationCount")}>{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label={t("ui.bestFrictionCoefficient")}>{item.bestFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.bestWearScarDiameter")}>{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.applicationNotes")} span={2}><span translate="no">{item.applicationNotes || "-"}</span></Descriptions.Item>
        <Descriptions.Item label={t("ui.created")}>{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.updated")}>{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
