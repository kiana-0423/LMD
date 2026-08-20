import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Tabs, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import {
  createAdditive,
  createBaseOil,
  deleteAdditive,
  deleteBaseOil,
  listAdditives,
  listBaseOils,
  listMolecules
} from "../../lib/api";
import { additiveFunctionLabels, additiveFunctionTags } from "../../lib/constants";
import type { Additive, BaseOil, Molecule } from "../../types";

type LibraryTab = "base-oils" | "additives";

export default function BaseAdditiveLibraryPage() {
  const [baseOilForm] = Form.useForm();
  const [additiveForm] = Form.useForm();
  const [baseOils, setBaseOils] = useState<BaseOil[]>([]);
  const [additives, setAdditives] = useState<Additive[]>([]);
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [activeTab, setActiveTab] = useState<LibraryTab>("base-oils");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedBaseOil, setSelectedBaseOil] = useState<BaseOil>();
  const [selectedAdditive, setSelectedAdditive] = useState<Additive>();

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const [nextBaseOils, nextAdditives, nextMolecules] = await Promise.all([
      listBaseOils(),
      listAdditives(),
      listMolecules()
    ]);
    setBaseOils(nextBaseOils);
    setAdditives(nextAdditives);
    setMolecules(nextMolecules);
  }

  function openCreateModal(tab: LibraryTab) {
    setActiveTab(tab);
    if (tab === "base-oils") {
      baseOilForm.resetFields();
      baseOilForm.setFieldsValue({ baseOilType: "Group III" });
    } else {
      additiveForm.resetFields();
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
        await createBaseOil(values);
        message.success("Base oil saved.");
      } else {
        const values = await additiveForm.validateFields();
        await createAdditive(values);
        message.success("Additive saved.");
      }
      setCreateOpen(false);
      await refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (errorMessage) message.error(errorMessage);
    } finally {
      setCreating(false);
    }
  }

  const moleculeOptions = molecules.map((molecule) => ({
    value: molecule.id,
    label: `${molecule.name} (${molecule.id})`
  }));
  const baseOilOptions = baseOils.map((baseOil) => ({
    value: baseOil.name,
    label: baseOil.name
  }));
  const additiveFunctionOptions = additiveFunctionTags.map((value) => ({
    value,
    label: additiveFunctionLabels[value] ?? value
  }));

  const baseOilColumns: ColumnsType<BaseOil> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "Name / Type",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.name}</span>
          <Tag>{row.baseOilType}</Tag>
        </Space>
      )
    },
    { title: "Representative Molecule", dataIndex: "representativeMoleculeId", render: (value) => value || "-" },
    {
      title: "Actions",
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedBaseOil(row)}>View</Button>
          <Button size="small" onClick={() => message.info("Base-oil editing will be added to the form in a future release.")}>Edit</Button>
          <Button size="small" danger onClick={() => confirmDeleteBaseOil(row)}>
            Delete
          </Button>
        </Space>
      )
    }
  ];

  const additiveColumns: ColumnsType<Additive> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "Name / Type",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.moleculeName}</span>
          {row.functionTypes.map((value) => <Tag key={value}>{additiveFunctionLabels[value] ?? value}</Tag>)}
        </Space>
      )
    },
    { title: "Representative Molecule", dataIndex: "moleculeId" },
    {
      title: "Actions",
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedAdditive(row)}>View</Button>
          <Button size="small" onClick={() => message.info("Additive editing will be added to the form in a future release.")}>Edit</Button>
          <Button size="small" danger onClick={() => confirmDeleteAdditive(row)}>
            Delete
          </Button>
        </Space>
      )
    }
  ];

  function confirmDeleteBaseOil(row: BaseOil) {
    Modal.confirm({
      title: "Delete this base oil?",
      content: row.name,
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const result = await deleteBaseOil(row.id);
        if (!result.success && !result.deleted) {
          message.warning("The base-oil record was not found.");
          return;
        }
        await refresh();
        if (selectedBaseOil?.id === row.id) setSelectedBaseOil(undefined);
        message.success("Deleted from the data source.");
      }
    });
  }

  function confirmDeleteAdditive(row: Additive) {
    Modal.confirm({
      title: "Delete this additive?",
      content: row.moleculeName,
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const result = await deleteAdditive(row.id);
        if (!result.success && !result.deleted) {
          message.warning("The additive record was not found.");
          return;
        }
        await refresh();
        if (selectedAdditive?.id === row.id) setSelectedAdditive(undefined);
        message.success("Deleted from the data source.");
      }
    });
  }

  return (
    <div className="page-grid table-page">
      <PageHeader
        title="Base Oils / Additives"
        description="Manage base oils that may not have SMILES and additives linked to Molecule Library records."
        extra={
          <Space wrap>
            <Button onClick={() => openCreateModal("base-oils")}>New Base Oil</Button>
            <Button type="primary" onClick={() => openCreateModal("additives")}>
              New Additive
            </Button>
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
              label: "Base Oils",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  columns={baseOilColumns}
                  dataSource={baseOils}
                  tableLayout="fixed"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                />
              )
            },
            {
              key: "additives",
              label: "Additives",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  columns={additiveColumns}
                  dataSource={additives}
                  tableLayout="fixed"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                />
              )
            }
          ]}
        />
      </Card>
      <Modal
        width={760}
        title={activeTab === "base-oils" ? "New Base Oil" : "New Additive"}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="Save"
        cancelText="Cancel"
      >
        {activeTab === "base-oils" ? (
          <Form form={baseOilForm} layout="vertical">
            <Form.Item label="Name" name="name" rules={[{ required: true, message: "Enter a base-oil name." }]}>
              <Input placeholder="Example: PAO-6" />
            </Form.Item>
            <Form.Item label="Base-oil Type" name="baseOilType">
              <Input placeholder="Example: Group III, PAO, Ester" />
            </Form.Item>
            <Form.Item label="Representative Molecule" name="representativeMoleculeId">
              <Select allowClear showSearch options={moleculeOptions} optionFilterProp="label" placeholder="Optional Molecule Library record" />
            </Form.Item>
            <Space size={12} wrap>
              <Form.Item label="Viscosity at 40°C" name="viscosity40c">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label="Viscosity at 100°C" name="viscosity100c">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label="Viscosity Index" name="viscosityIndex">
                <InputNumber precision={1} />
              </Form.Item>
              <Form.Item label="Density" name="density">
                <InputNumber min={0} precision={4} />
              </Form.Item>
              <Form.Item label="Pour Point" name="pourPoint">
                <InputNumber precision={1} />
              </Form.Item>
              <Form.Item label="Flash Point" name="flashPoint">
                <InputNumber precision={1} />
              </Form.Item>
            </Space>
            <Form.Item label="Supplier" name="supplier">
              <Input />
            </Form.Item>
            <Form.Item label="Batch" name="batchNumber">
              <Input />
            </Form.Item>
            <Form.Item label="Notes" name="notes">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        ) : (
          <Form form={additiveForm} layout="vertical">
            <Form.Item label="Representative Molecule" name="moleculeId" rules={[{ required: true, message: "Select a representative molecule." }]}>
              <Select showSearch options={moleculeOptions} optionFilterProp="label" placeholder="Select an additive molecule from the library" />
            </Form.Item>
            <Form.Item label="Function Types" name="functionTypes">
              <Select mode="multiple" options={additiveFunctionOptions} />
            </Form.Item>
            <Form.Item label="Active Elements" name="activeElements">
              <Select mode="tags" options={["C", "H", "O", "N", "S", "P", "Zn", "Mo", "B", "Cl"].map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Space size={12} wrap>
              <Form.Item label="Minimum Typical Concentration" name="typicalConcentrationMin">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label="Maximum Typical Concentration" name="typicalConcentrationMax">
                <InputNumber min={0} precision={3} />
              </Form.Item>
              <Form.Item label="Concentration Unit" name="concentrationUnit">
                <Input placeholder="wt%" />
              </Form.Item>
            </Space>
            <Form.Item label="Compatible Base Oils" name="compatibleBaseOils">
              <Select mode="tags" options={baseOilOptions} placeholder="Enter or select existing base-oil names" />
            </Form.Item>
            <Form.Item label="Application Notes" name="applicationNotes">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <Modal
        width={760}
        title="Complete Base-oil Data"
        open={Boolean(selectedBaseOil)}
        onCancel={() => setSelectedBaseOil(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedBaseOil(undefined)}>Close</Button>}
      >
        {selectedBaseOil && <BaseOilDetails item={selectedBaseOil} />}
      </Modal>
      <Modal
        width={760}
        title="Complete Additive Data"
        open={Boolean(selectedAdditive)}
        onCancel={() => setSelectedAdditive(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedAdditive(undefined)}>Close</Button>}
      >
        {selectedAdditive && <AdditiveDetails item={selectedAdditive} />}
      </Modal>
    </div>
  );
}

function BaseOilDetails({ item }: { item: BaseOil }) {
  return (
    <Card size="small" title={`${item.id} · ${item.name}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="Name / Type">{item.name} / {item.baseOilType}</Descriptions.Item>
        <Descriptions.Item label="Representative Molecule">{item.representativeMoleculeId || "-"}</Descriptions.Item>
        <Descriptions.Item label="Supplier">{item.supplier || "-"}</Descriptions.Item>
        <Descriptions.Item label="Viscosity at 40°C">{item.viscosity40c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Viscosity at 100°C">{item.viscosity100c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Viscosity Index">{item.viscosityIndex ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Density">{item.density ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Pour Point">{item.pourPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Flash Point">{item.flashPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Batch">{item.batchNumber || "-"}</Descriptions.Item>
        <Descriptions.Item label="Formulation Count">{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label="Notes" span={2}>{item.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="Created">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="Updated">{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function AdditiveDetails({ item }: { item: Additive }) {
  return (
    <Card size="small" title={`${item.id} · ${item.moleculeName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="Name / Type">
          <Space size={4} wrap>
            <span>{item.moleculeName}</span>
            {item.functionTypes.map((value) => <Tag key={value}>{additiveFunctionLabels[value] ?? value}</Tag>)}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Representative Molecule">{item.moleculeId}</Descriptions.Item>
        <Descriptions.Item label="Active Elements">{item.activeElements.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label="Typical Concentration">
          {item.typicalConcentrationMin}-{item.typicalConcentrationMax} {item.concentrationUnit}
        </Descriptions.Item>
        <Descriptions.Item label="Compatible Base Oils">{item.compatibleBaseOils.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label="Formulation Count">{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label="Best Friction Coefficient">{item.bestFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Best Wear Scar Diameter">{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Application Notes" span={2}>{item.applicationNotes || "-"}</Descriptions.Item>
        <Descriptions.Item label="Created">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="Updated">{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
