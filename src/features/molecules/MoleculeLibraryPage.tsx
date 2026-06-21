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
      title: "确认删除分子？",
      content: row.name,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const result = await deleteMolecule(row.id);
        if (!result.success && !result.deleted) {
          message.warning("未找到需要删除的分子记录。");
          return;
        }
        await refresh();
        if (selected?.id === row.id) setSelected(undefined);
        message.success("已从数据源删除。");
      }
    });
  }

  const columns: ColumnsType<Molecule> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "名称类型",
      render: (_, record) => (
        <Space size={6} wrap>
          <span>{record.name}</span>
          <Tag>{moleculeCategoryLabels[record.category] ?? record.category}</Tag>
          {record.duplicateOf && <Tag color="orange">Duplicate copy</Tag>}
        </Space>
      )
    },
    {
      title: "代表分子",
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
      title: "操作",
      width: 300,
      render: (_, record) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelected(record)}>查看</Button>
          <Button size="small" onClick={() => message.info("编辑分子功能请使用分子绘画页面。")}>编辑</Button>
          <Button size="small" danger onClick={() => confirmDelete(record)}>
            删除
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
        title="分子库"
        description="分子表格仅显示描述符状态；完整 RDKit 与 Mordred 描述符保存在数据库中，并在详情抽屉中查看摘要。"
      />
      {loading ? <LoadingBlock /> : null}
      {!loading && errorText ? (
        <Card className="error-panel">
          <Typography.Title level={4}>分子库加载失败</Typography.Title>
          <Typography.Paragraph>{errorText}</Typography.Paragraph>
          <Button type="primary" onClick={refresh}>
            重试
          </Button>
        </Card>
      ) : null}
      {!loading && !errorText ? (
      <Card>
        <div className="table-toolbar">
          <div className="left">
            <Input.Search
              allowClear
              placeholder="搜索名称、SMILES、InChIKey"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 320 }}
            />
            <Select
              allowClear
              placeholder="类别"
              value={category}
              onChange={setCategory}
              style={{ width: 220 }}
              options={moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }))}
            />
          </div>
          <Space className="right">
            <Button type="primary" onClick={() => navigate("/molecule-sketcher")}>打开分子绘画</Button>
            <Select
              placeholder="包含元素"
              style={{ width: 180 }}
              options={["S", "P", "N", "O", "B", "Mo", "Zn"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="来源"
              style={{ width: 170 }}
              value={source}
              onChange={setSource}
              options={["ketcher", "smiles_input", "molfile_input", "library_edit"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="导入方式"
              style={{ width: 170 }}
              value={importMode}
              onChange={setImportMode}
              options={["manual_save", "new_import", "new_copy", "library_update"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder="重复状态"
              style={{ width: 160 }}
              value={duplicateStatus}
              onChange={setDuplicateStatus}
              options={[
                { value: "original", label: "原始记录" },
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
          locale={{ emptyText: "数据库中暂无分子记录。" }}
          pagination={{ pageSize: 6, showSizeChanger: false }}
        />
      </Card>
      ) : null}
      <MoleculeDetailDrawer molecule={selected} open={Boolean(selected)} onClose={() => setSelected(undefined)} />
    </div>
  );
}
