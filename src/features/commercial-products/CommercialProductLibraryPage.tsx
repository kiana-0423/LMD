import {
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import { MaterialPropertiesFields, MaterialPropertiesDetails } from "./MaterialProperties";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AsyncBoundary from "../../components/AsyncBoundary";
import PageHeader from "../../components/PageHeader";
import PagedModal from "../../components/PagedModal";
import { useLanguage } from "../../i18n/LanguageContext";
import {
  deleteCommercialProduct,
  getCommercialProduct,
  listCommercialProductPage,
  registerCommercialProduct,
  saveCommercialProduct,
  type CommercialProduct,
  type CommercialProductInput
} from "../../lib/api";
import { backendErrorText } from "../../lib/backendErrors";
import { useAsyncResource } from "../../lib/useAsyncResource";

const blank: CommercialProductInput = {
  name: "",
  category: "",
  generalFormula: "",
  manufacturer: "",
  productionDate: "",
  batchNumber: "",
  productNumber: "",
  supplier: "",
  notes: "",
  materialProperties: { custom: [] }
};

export default function CommercialProductLibraryPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<CommercialProductInput>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>();
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState("info");
  const [editing, setEditing] = useState<CommercialProduct>();
  const [selected, setSelected] = useState<CommercialProduct>();
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState<string>();
  const products = useAsyncResource(
    () => listCommercialProductPage({ page, pageSize: 10, search: query }, category),
    [page, query, category]
  );
  const selectedId = searchParams.get("id");
  const requestedProduct = useAsyncResource(
    () => (selectedId ? getCommercialProduct(selectedId) : Promise.resolve(undefined)),
    [selectedId]
  );
  const details = selectedId ? requestedProduct.data : selected;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  function edit(product?: CommercialProduct) {
    setEditing(product);
    form.resetFields();
    form.setFieldsValue({ ...blank, ...product, materialProperties: product?.materialProperties ?? { custom: [] } });
    setEditorTab("info");
    setEditorOpen(true);
  }

  function closeDetails() {
    setSelected(undefined);
    if (selectedId) setSearchParams({});
  }

  async function save() {
    let values: CommercialProductInput;
    try {
      values = await form.validateFields();
    } catch (error) {
      const firstField = (error as { errorFields?: { name: (string | number)[] }[] }).errorFields?.[0]?.name[0];
      setEditorTab(firstField === "materialProperties" ? "properties" : "info");
      return;
    }
    setSaving(true);
    try {
      const record = await saveCommercialProduct({ ...blank, ...values, category: values.category ?? "" }, editing?.id);
      setEditorOpen(false);
      if (selected?.id === record.id) setSelected(record);
      requestedProduct.reload();
      products.reload();
      message.success(t("product.saved"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setSaving(false);
    }
  }

  async function register(product: CommercialProduct, role: "base_oil" | "additive") {
    setRegistering(product.id);
    try {
      const record = await registerCommercialProduct(product.id, role);
      if (selected?.id === record.id) setSelected(record);
      requestedProduct.reload();
      products.reload();
      message.success(t("product.registered"));
    } catch (error) {
      message.error(backendErrorText(error, t));
    } finally {
      setRegistering(undefined);
    }
  }

  function remove(product: CommercialProduct) {
    Modal.confirm({
      title: t("product.deleteConfirm"),
      content: (
        <span translate="no">
          {product.name} · {product.batchNumber || product.productNumber}
        </span>
      ),
      okText: t("ui.delete"),
      cancelText: t("ui.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteCommercialProduct(product.id);
          if (details?.id === product.id) closeDetails();
          if (products.data?.items.length === 1 && page > 1) setPage(page - 1);
          else products.reload();
          message.success(t("product.deleted"));
        } catch (error) {
          message.error(backendErrorText(error, t));
          throw error;
        }
      }
    });
  }

  const registrationActions = (product: CommercialProduct) => (
    <Space wrap>
      <Button
        size="small"
        disabled={Boolean(product.baseOilId) || Boolean(registering)}
        onClick={() => void register(product, "base_oil")}
      >
        {t(product.baseOilId ? "product.inBaseOils" : "product.addBaseOil")}
      </Button>
      <Button
        size="small"
        disabled={Boolean(product.additiveId) || Boolean(registering)}
        onClick={() => void register(product, "additive")}
      >
        {t(product.additiveId ? "product.inAdditives" : "product.addAdditive")}
      </Button>
    </Space>
  );
  const columns: ColumnsType<CommercialProduct> = [
    {
      title: t("product.name"),
      render: (_, row) => (
        <Space wrap>
          <span translate="no">{row.name}</span>
          {row.category && <Tag>{t(row.category === "base_oil" ? "product.baseOil" : "product.additive")}</Tag>}
        </Space>
      )
    },
    { title: t("product.manufacturer"), dataIndex: "manufacturer" },
    { title: t("product.productNumber"), dataIndex: "productNumber" },
    { title: t("product.batchNumber"), dataIndex: "batchNumber" },
    { title: t("product.productionDate"), dataIndex: "productionDate", width: 120 },
    {
      title: t("ui.actions"),
      width: 270,
      render: (_, row) => (
        <Space size={6}>
          <Button
            size="small"
            onClick={() => {
              setSearchParams({});
              setSelected(row);
            }}
          >
            {t("ui.view")}
          </Button>
          <Button size="small" onClick={() => edit(row)}>
            {t("ui.edit")}
          </Button>
          <Button size="small" danger onClick={() => remove(row)}>
            {t("ui.delete")}
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: "base_oil",
                  label: t(row.baseOilId ? "product.inBaseOils" : "product.addBaseOil"),
                  disabled: Boolean(row.baseOilId)
                },
                {
                  key: "additive",
                  label: t(row.additiveId ? "product.inAdditives" : "product.addAdditive"),
                  disabled: Boolean(row.additiveId)
                }
              ],
              onClick: ({ key }) => void register(row, key as "base_oil" | "additive")
            }}
            trigger={["click"]}
          >
            <Button size="small" disabled={Boolean(registering)}>
              {t("product.register")}
            </Button>
          </Dropdown>
        </Space>
      )
    }
  ];

  return (
    <div className="page-grid table-page commercial-product-library-page">
      <PageHeader
        title={t("menu.products")}
        description={t("product.description")}
        extra={
          <Button type="primary" onClick={() => edit()}>
            {t("product.new")}
          </Button>
        }
      />
      <Card>
        <Space wrap className="table-toolbar">
          <Input.Search
            allowClear
            value={search}
            aria-label={t("product.search")}
            placeholder={t("product.search")}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 360, maxWidth: "100%" }}
          />
          <Select
            allowClear
            value={category}
            aria-label={t("product.category")}
            placeholder={t("product.allTypes")}
            style={{ width: 180 }}
            onChange={(value) => {
              setCategory(value);
              setPage(1);
            }}
            options={[
              { value: "base_oil", label: t("product.baseOil") },
              { value: "additive", label: t("product.additive") }
            ]}
          />
        </Space>
        <AsyncBoundary loading={products.loading} error={products.error} onRetry={products.reload}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={products.data?.items ?? []}
            scroll={{ x: 1120 }}
            pagination={{
              current: page,
              pageSize: 10,
              total: products.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage
            }}
          />
        </AsyncBoundary>
      </Card>
      <Modal
        centered
        width={880}
        className="catalogue-editor-modal"
        title={t(editing ? "product.edit" : "product.new")}
        open={editorOpen}
        onCancel={() => {
          if (!saving) setEditorOpen(false);
        }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText={t("ui.save")}
        cancelText={t("ui.cancel")}
      >
        <Form form={form} layout="vertical" disabled={saving}>
          <Tabs
            activeKey={editorTab}
            onChange={setEditorTab}
            items={[
              {
                key: "info",
                label: t("product.batchInfo"),
                forceRender: true,
                children: (
                  <>
                    <Typography.Paragraph type="secondary">{t("product.batchHelp")}</Typography.Paragraph>
                    <div className="catalogue-editor-form">
                      <Form.Item
                        label={t("product.name")}
                        name="name"
                        rules={[{ required: true, whitespace: true, message: t("product.nameRequired") }]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item label={t("product.category")} name="category">
                        <Select
                          allowClear
                          options={[
                            { value: "base_oil", label: t("product.baseOil") },
                            { value: "additive", label: t("product.additive") }
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label={t("product.manufacturer")} name="manufacturer">
                        <Input />
                      </Form.Item>
                      <Form.Item label={t("product.productNumber")} name="productNumber">
                        <Input />
                      </Form.Item>
                      <Form.Item label={t("product.productionDate")} name="productionDate">
                        <Input type="date" />
                      </Form.Item>
                      <Form.Item label={t("product.batchNumber")} name="batchNumber">
                        <Input />
                      </Form.Item>
                      <Form.Item label={t("product.generalFormula")} name="generalFormula">
                        <Input />
                      </Form.Item>
                      <Form.Item label={t("ui.supplier")} name="supplier">
                        <Input />
                      </Form.Item>
                      <Form.Item className="catalogue-editor-wide" label={t("ui.notes")} name="notes">
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </div>
                  </>
                )
              },
              {
                key: "properties",
                label: t("product.materialProperties"),
                forceRender: true,
                children: (
                  <div style={{ maxHeight: "50vh", overflowY: "auto", paddingRight: 8 }}>
                    <MaterialPropertiesFields />
                  </div>
                )
              }
            ]}
          />
        </Form>
      </Modal>
      <PagedModal
        width={800}
        title={t("product.details")}
        open={!editorOpen && (Boolean(details) || Boolean(selectedId))}
        onCancel={closeDetails}
        footer={<Button onClick={closeDetails}>{t("ui.close")}</Button>}
      >
        <AsyncBoundary
          loading={Boolean(selectedId) && requestedProduct.loading}
          error={selectedId ? requestedProduct.error : undefined}
          onRetry={requestedProduct.reload}
        >
          {details && (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label={t("product.name")}>{details.name}</Descriptions.Item>
                <Descriptions.Item label={t("product.category")}>
                  {details.category ? t(details.category === "base_oil" ? "product.baseOil" : "product.additive") : "—"}
                </Descriptions.Item>
                <Descriptions.Item label={t("product.manufacturer")}>{details.manufacturer || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("product.productNumber")}>{details.productNumber || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("product.productionDate")}>
                  {details.productionDate || "—"}
                </Descriptions.Item>
                <Descriptions.Item label={t("product.batchNumber")}>{details.batchNumber || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("product.generalFormula")}>
                  {details.generalFormula || "—"}
                </Descriptions.Item>
                <Descriptions.Item label={t("ui.supplier")}>{details.supplier || "—"}</Descriptions.Item>
                <Descriptions.Item label={t("ui.notes")} span={2}>
                  {details.notes || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="ID" span={2}>
                  {details.id}
                </Descriptions.Item>
                <Descriptions.Item label={t("ui.created")}>{details.createdAt}</Descriptions.Item>
                <Descriptions.Item label={t("ui.updated")}>{details.updatedAt}</Descriptions.Item>
              </Descriptions>
              <MaterialPropertiesDetails properties={details.materialProperties} />
              {registrationActions(details)}
              <Button onClick={() => edit(details)}>{t("ui.edit")}</Button>
            </Space>
          )}
        </AsyncBoundary>
      </PagedModal>
    </div>
  );
}
