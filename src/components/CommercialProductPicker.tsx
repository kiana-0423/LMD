import { Input, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { listCommercialProductPage, type CommercialProduct } from "../lib/api";
import { useAsyncResource } from "../lib/useAsyncResource";
import AsyncBoundary from "./AsyncBoundary";

const PAGE_SIZE = 5;

/** Select an existing batch, including products whose category has not been recorded. */
export default function CommercialProductPicker({
  role,
  value,
  onChange,
  disabled = false
}: {
  role: "base_oil" | "additive";
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState({ search: "", page: 1 });
  const products = useAsyncResource(
    () => listCommercialProductPage({ ...query, pageSize: PAGE_SIZE }),
    [query.search, query.page]
  );
  const isRegistered = (product: CommercialProduct) =>
    Boolean(role === "base_oil" ? product.baseOilId : product.additiveId);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">{t("product.chooseHelp")}</Typography.Text>
      <Input.Search
        allowClear
        disabled={disabled}
        placeholder={t("product.search")}
        aria-label={t("product.search")}
        onSearch={(search) => {
          onChange(undefined);
          setQuery({ search, page: 1 });
        }}
      />
      <AsyncBoundary loading={products.loading && !products.data} error={products.error} onRetry={products.reload}>
        <Table<CommercialProduct>
          size="small"
          rowKey="id"
          loading={products.loading}
          dataSource={products.data?.items ?? []}
          rowSelection={{
            type: "radio",
            selectedRowKeys: value ? [value] : [],
            onChange: (keys) => onChange(keys[0] as string | undefined),
            getCheckboxProps: (product) => ({
              disabled: disabled || products.loading || isRegistered(product),
              "aria-label": `${product.name} · ${product.batchNumber || product.id}`
            })
          }}
          columns={[
            {
              title: t("product.name"),
              render: (_, product) => (
                <Space direction="vertical" size={0}>
                  <span translate="no">{product.name}</span>
                  {isRegistered(product) && <Tag>{t(role === "base_oil" ? "product.inBaseOils" : "product.inAdditives")}</Tag>}
                </Space>
              )
            },
            { title: t("product.category"), render: (_, product) => product.category ? t(product.category === "base_oil" ? "product.baseOil" : "product.additive") : "-" },
            { title: t("product.manufacturer"), dataIndex: "manufacturer" },
            { title: t("product.batchNumber"), dataIndex: "batchNumber" },
            { title: t("product.productNumber"), dataIndex: "productNumber" }
          ]}
          pagination={{
            current: query.page,
            pageSize: PAGE_SIZE,
            total: products.data?.total ?? 0,
            showSizeChanger: false,
            disabled,
            onChange: (page) => {
              onChange(undefined);
              setQuery((previous) => ({ ...previous, page }));
            }
          }}
        />
      </AsyncBoundary>
    </Space>
  );
}
