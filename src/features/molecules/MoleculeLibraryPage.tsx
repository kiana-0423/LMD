import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import { useLanguage } from "../../i18n/LanguageContext";
import { deleteMolecule, getMolecule, listMoleculePage } from "../../lib/api";
import { descriptorStatusLabelKeys, moleculeCategories, moleculeCategoryLabelKeys } from "../../lib/constants";
import type { DescriptorStatus, Molecule } from "../../types";
import { reportDeletion } from "../../components/DeletionResultNotice";
import MoleculeDetailDrawer from "./MoleculeDetailDrawer";
import { backendErrorText } from "../../lib/backendErrors";

function statusColor(status: DescriptorStatus) {
  if (status === "calculated") return "green";
  if (status === "mock") return "gold";
  if (status === "failed") return "red";
  return "blue";
}

export default function MoleculeLibraryPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [data, setData] = useState<Molecule[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>();
  const [element, setElement] = useState<string>();
  const [source, setSource] = useState<string>();
  const [importMode, setImportMode] = useState<string>();
  const [duplicateStatus, setDuplicateStatus] = useState<string>();
  const [selected, setSelected] = useState<Molecule>();
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const refresh = useCallback(async (requestedPage = page) => {
    setLoading(true);
    setErrorText("");
    try {
      const result = await listMoleculePage({
        search,
        category,
        element,
        source,
        importMode,
        duplicateStatus: duplicateStatus as "original" | "duplicate" | undefined,
        page: requestedPage,
        pageSize
      });
      setData(result.items);
      setTotal(result.total);
    } catch (error) {
      // Stored raw and translated at render: a failure that has already happened should still
      // read in whatever language the user switches to afterwards.
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [category, duplicateStatus, element, importMode, page, search, source]);

  useEffect(() => {
    const timer = window.setTimeout(() => refresh(), 250);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function openDetails(row: Molecule) {
    try {
      setSelected((await getMolecule(row.id)) ?? row);
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  function confirmDelete(row: Molecule) {
    Modal.confirm({
      title: t("molecule.deleteConfirm"),
      content: <span translate="no">{row.name}</span>,
      okText: t("molecule.delete"),
      okButtonProps: { danger: true },
      cancelText: t("molecule.cancel"),
      onOk: async () => {
        const result = await deleteMolecule(row.id);
        if (result.deleted) {
          await refresh();
          if (selected?.id === row.id) setSelected(undefined);
        }
        // A molecule owns its structure files and attachments; if any survived the delete, say so
        // rather than reporting a clean success.
        reportDeletion(result, t, "deletion.moleculeDeleted");
      }
    });
  }

  const columns: ColumnsType<Molecule> = [
    { title: t("molecule.columnId"), dataIndex: "id", width: 140 },
    {
      title: t("molecule.columnNameType"),
      render: (_, record) => (
        <Space size={6} wrap>
          <span translate="no">{record.name}</span>
          <Tag>{t(moleculeCategoryLabelKeys[record.category]) ?? record.category}</Tag>
          {record.duplicateOf && <Tag color="orange">{t("molecule.duplicate")}</Tag>}
        </Space>
      )
    },
    {
      title: t("molecule.columnRepresentative"),
      render: (_, record) => (
        <Space size={6} wrap>
          <span className="mono" translate="no">{record.formula || record.inchiKey || record.smilesCanonical}</span>
          <Tag color={statusColor(record.mordredDescriptorStatus)}>
            {t(descriptorStatusLabelKeys[record.mordredDescriptorStatus] ?? "label.missing")}
          </Tag>
        </Space>
      )
    },
    {
      title: t("molecule.columnActions"),
      width: 300,
      render: (_, record) => (
        <Space size={6}>
          <Button size="small" onClick={() => openDetails(record)}>
            {t("molecule.view")}
          </Button>
          <Button size="small" danger onClick={() => confirmDelete(record)}>
            {t("molecule.delete")}
          </Button>
          <Button size="small" onClick={() => navigate(`/molecule-sketcher?moleculeId=${record.id}`)}>
            {t("molecule.openInSketcher")}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-grid table-page molecule-library-page">
      <PageHeader
        title={t("molecule.libraryTitle")}
        description={t("molecule.libraryDescription")}
      />
      {loading ? <LoadingBlock /> : null}
      {!loading && errorText ? (
        <Card className="error-panel">
          <Typography.Title level={4}>{t("molecule.loadFailed")}</Typography.Title>
          <Typography.Paragraph>{backendErrorText(errorText, t)}</Typography.Paragraph>
          <Button type="primary" onClick={() => refresh()}>
            {t("molecule.retry")}
          </Button>
        </Card>
      ) : null}
      {!loading && !errorText ? (
      <Card>
        <div className="table-toolbar">
          <div className="left">
            <Input.Search
              allowClear
              placeholder={t("molecule.searchPlaceholder")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              style={{ width: 320 }}
            />
            <Select
              allowClear
              placeholder={t("molecule.category")}
              value={category}
              onChange={(value) => {
                setCategory(value);
                setPage(1);
              }}
              style={{ width: 220 }}
              options={moleculeCategories.map((value) => ({ value, label: t(moleculeCategoryLabelKeys[value]) }))}
            />
          </div>
          <Space className="right">
            <Button type="primary" onClick={() => navigate("/molecule-sketcher")}>
              {t("molecule.openSketcher")}
            </Button>
            <Select
              allowClear
              placeholder={t("molecule.containsElement")}
              style={{ width: 180 }}
              value={element}
              onChange={(value) => {
                setElement(value);
                setPage(1);
              }}
              options={["S", "P", "N", "O", "B", "Mo", "Zn"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder={t("molecule.source")}
              style={{ width: 170 }}
              value={source}
              onChange={(value) => {
                setSource(value);
                setPage(1);
              }}
              options={["ketcher", "smiles_input", "molfile_input", "library_edit"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder={t("molecule.importMode")}
              style={{ width: 170 }}
              value={importMode}
              onChange={(value) => {
                setImportMode(value);
                setPage(1);
              }}
              options={["manual_save", "new_import", "new_copy", "library_update"].map((value) => ({ value, label: value }))}
            />
            <Select
              allowClear
              placeholder={t("molecule.duplicateStatus")}
              style={{ width: 160 }}
              value={duplicateStatus}
              onChange={(value) => {
                setDuplicateStatus(value);
                setPage(1);
              }}
              options={[
                { value: "original", label: t("molecule.original") },
                { value: "duplicate", label: t("molecule.duplicate") }
              ]}
            />
          </Space>
        </div>
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={data}
          tableLayout="fixed"
          locale={{ emptyText: t("molecule.emptyTable") }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            onChange: setPage
          }}
        />
      </Card>
      ) : null}
      <MoleculeDetailDrawer
        molecule={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        // A generated structure changes the stored record, so the drawer and the table behind it
        // both follow it rather than continuing to describe the molecule as it was opened.
        onGenerated={(updated) => {
          setSelected(updated);
          setData((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
        }}
      />
    </div>
  );
}
