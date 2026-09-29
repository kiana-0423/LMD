import { Button, Input, Table } from "antd";
import { useState } from "react";
import AsyncBoundary from "../../components/AsyncBoundary";
import PagedModal from "../../components/PagedModal";
import { useLanguage } from "../../i18n/LanguageContext";
import { listExperimentPage } from "../../lib/api";
import { TEST_TYPES } from "../../lib/experimentProtocol";
import { useAsyncResource } from "../../lib/useAsyncResource";
import type { Experiment } from "../../types";

const PAGE_SIZE = 10;

export default function ExperimentRecordsModal({
  onClose,
  onView,
  revision
}: {
  onClose: () => void;
  onView: (id: string) => void;
  revision: number;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const records = useAsyncResource(
    () => listExperimentPage({ page, pageSize: PAGE_SIZE, search }),
    [page, search, revision]
  );

  return (
    <PagedModal
      width={1000}
      title={t("test.records")}
      open
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("ui.close")}</Button>}
    >
      <div className="table-toolbar">
        <Input.Search
          aria-label={t("test.searchRecords")}
          placeholder={t("test.searchRecords")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <AsyncBoundary loading={records.loading} error={records.error} onRetry={records.reload}>
        <Table<Experiment>
          size="small"
          rowKey="id"
          dataSource={records.data?.items ?? []}
          columns={[
            { title: t("ui.testId"), dataIndex: "id", ellipsis: true },
            {
              title: t("ui.formulationName"),
              dataIndex: "formulationName",
              render: (value: string) => <span translate="no">{value}</span>
            },
            {
              title: t("ui.testType"),
              dataIndex: "testType",
              render: (value: string) => {
                const type = TEST_TYPES.find((entry) => entry.value === value);
                return type?.labelKey ? t(type.labelKey) : value;
              }
            },
            { title: t("ui.experimentDate"), dataIndex: "experimentDate" },
            { title: t("ui.enteredAt"), dataIndex: "createdAt" },
            {
              title: t("ui.actions"),
              width: 80,
              render: (_, row) => (
                <Button size="small" onClick={() => onView(row.id)}>
                  {t("ui.view")}
                </Button>
              )
            }
          ]}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: records.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage
          }}
        />
      </AsyncBoundary>
    </PagedModal>
  );
}
