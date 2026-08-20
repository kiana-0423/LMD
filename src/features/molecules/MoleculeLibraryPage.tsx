import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import { deleteMolecule, listMolecules } from "../../lib/api";
import { descriptorStatusLabels, moleculeCategories, moleculeCategoryLabels } from "../../lib/constants";
import type { DescriptorStatus, Molecule } from "../../types";
import MoleculeDetailDrawer from "./MoleculeDetailDrawer";

function statusColor(status: DescriptorStatus) {
  if (status === "calculated") return "green";
  if (status === "mock") return "gold";
  if (status === "failed") return "red";
  return "blue";
}

export default function MoleculeLibraryPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Molecule[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>();
  const [source, setSource] = useState<string>();
  const [importMode, setImportMode] = useState<string>();
  const [duplicateStatus, setDuplicateStatus] = useState<string>();
  const [selected, setSelected] = useState<Molecule>();
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setErrorText("");
    try {
      setData(await listMolecules());
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(
    () =>
      data.filter((item) => {
        const q = search.toLowerCase();
        const searchMatch =
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.smilesCanonical.toLowerCase().includes(q) ||
          item.inchiKey.toLowerCase().includes(q);
        const categoryMatch = !category || item.category === category;
        const sourceMatch = !source || item.source === source || item.dataSource === source;
        const importModeMatch = !importMode || item.importMode === importMode;
        const duplicateMatch =
          !duplicateStatus ||
          (duplicateStatus === "duplicate" ? Boolean(item.duplicateOf) : !item.duplicateOf);
        return searchMatch && categoryMatch && sourceMatch && importModeMatch && duplicateMatch;
      }),
    [data, search, category, source, importMode, duplicateStatus]
  );

  function confirmDelete(row: Molecule) {
    Modal.confirm({
      title: "Delete this molecule?",
      content: row.name,
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const result = await deleteMolecule(row.id);
        if (!result.success && !result.deleted) {
          message.warning("The molecule record was not found.");
          return;
        }
        await refresh();
        if (selected?.id === row.id) setSelected(undefined);
        message.success("Deleted from the data source.");
      }
    });
  }

  const columns: ColumnsType<Molecule> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "Name / Type",
      render: (_, record) => (
        <Space size={6} wrap>
          <span>{record.name}</span>
          <Tag>{moleculeCategoryLabels[record.category] ?? record.category}</Tag>
          {record.duplicateOf && <Tag color="orange">Duplicate copy</Tag>}
        </Space>
      )
    },
    {
      title: "Representative Molecule",
      render: (_, record) => (
        <Space size={6} wrap>
          <span className="mono">{record.formula || record.inchiKey || record.smilesCanonical}</span>
          <Tag color={statusColor(record.mordredDescriptorStatus)}>
            {descriptorStatusLabels[record.mordredDescriptorStatus] ?? record.mordredDescriptorStatus}
          </Tag>
        </Space>
      )
    },
    {
      title: "Actions",
      width: 300,
      render: (_, record) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelected(record)}>View</Button>
          <Button size="small" onClick={() => message.info("Use Molecule Sketcher to edit molecules.")}>Edit</Button>
          <Button size="small" danger onClick={() => confirmDelete(record)}>
            Delete
          </Button>
          <Button size="small" onClick={() => navigate(`/molecule-sketcher?moleculeId=${record.id}`)}>
            Open in Sketcher
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-grid table-page molecule-library-page">
      <PageHeader
        title="Molecule Library"
        description="The table shows descriptor status. Complete RDKit and Mordred descriptors are stored in the database and summarized in the details drawer."
      />
      {loading ? <LoadingBlock /> : null}
      {!loading && errorText ? (
        <Card className="error-panel">
          <Typography.Title level={4}>Failed to load the molecule library</Typography.Title>
          <Typography.Paragraph>{errorText}</Typography.Paragraph>
          <Button type="primary" onClick={refresh}>
            Retry
          </Button>
        </Card>
      ) : null}
      {!loading && !errorText ? (
      <Card>
        <div className="table-toolbar">
          <div className="left">
            <Input.Search
              allowClear
              placeholder="Search name, SMILES, or InChIKey"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 320 }}
            />
            <Select
              allowClear
              placeholder="Category"
              value={category}
              onChange={setCategory}
              style={{ width: 220 }}
              options={moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }))}
            />
          </div>
          <Space className="right">
            <Button type="primary" onClick={() => navigate("/molecule-sketcher")}>Open Molecule Sketcher</Button>
            <Select
              placeholder="Contains element"
              style={{ width: 180 }}
              options={["S", "P", "N", "O", "B", "Mo", "Zn"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="Source"
              style={{ width: 170 }}
              value={source}
              onChange={setSource}
              options={["ketcher", "smiles_input", "molfile_input", "library_edit"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="Import mode"
              style={{ width: 170 }}
              value={importMode}
              onChange={setImportMode}
              options={["manual_save", "new_import", "new_copy", "library_update"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="Duplicate status"
              style={{ width: 160 }}
              value={duplicateStatus}
              onChange={setDuplicateStatus}
              options={[
                { value: "original", label: "Original record" },
                { value: "duplicate", label: "Duplicate copy" }
              ]}
            />
          </Space>
        </div>
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          tableLayout="fixed"
          locale={{ emptyText: "No molecule records in the database." }}
          pagination={{ pageSize: 6, showSizeChanger: false }}
        />
      </Card>
      ) : null}
      <MoleculeDetailDrawer molecule={selected} open={Boolean(selected)} onClose={() => setSelected(undefined)} />
    </div>
  );
}
