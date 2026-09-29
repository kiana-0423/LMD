import { Empty, Select, message } from "antd";
import { useState } from "react";
import AsyncBoundary from "../../components/AsyncBoundary";
import PagedModal from "../../components/PagedModal";
import { useLanguage } from "../../i18n/LanguageContext";
import { getExperimentWithResults, updateExperimentRecord } from "../../lib/api";
import { backendErrorText } from "../../lib/backendErrors";
import { experimentPayload } from "../../lib/experimentProtocol";
import { useAsyncAction, useAsyncResource } from "../../lib/useAsyncResource";
import ExperimentRecordedDetails from "./ExperimentRecordedDetails";

/** Mounted for one selected id so reopening always reads the stored record. */
export default function ExperimentDetailModal({
  experimentId,
  onClose,
  onUpdated
}: {
  experimentId: string;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [resultId, setResultId] = useState<string>();
  const record = useAsyncResource(() => getExperimentWithResults(experimentId), [experimentId]);
  const item = record.data?.experiment;
  const results = record.data?.results ?? [];
  const result = results.find((entry) => entry.id === resultId) ?? results[0];
  const save = useAsyncAction(
    async (values: Record<string, unknown>) => {
      await updateExperimentRecord(experimentId, {
        ...experimentPayload(values),
        performanceResultId: result?.id
      });
    },
    {
      onDone: () => {
        setEditing(false);
        record.reload();
        onUpdated?.();
        message.success(t("ui.experimentalDataCorrected"));
      },
      onError: (error) => message.error(backendErrorText(error, t))
    }
  );

  return (
    <PagedModal width={780} title={t("ui.enteredExperimentalData")} open onCancel={onClose} footer={null}>
      <AsyncBoundary loading={record.loading} error={record.error} onRetry={record.reload}>
        {item ? (
          <>
            {results.length > 1 && (
              <Select
                aria-label={t("ui.performanceResults")}
                value={result?.id}
                disabled={editing}
                onChange={setResultId}
                style={{ width: "100%", marginBottom: 12 }}
                options={results.map((entry) => ({ value: entry.id, label: `${entry.createdAt} · ${entry.id}` }))}
              />
            )}
            <ExperimentRecordedDetails
              key={result?.id ?? item.id}
              item={item}
              result={result}
              editing={editing}
              saving={save.running}
              onEdit={() => setEditing(true)}
              onCancelEdit={() => setEditing(false)}
              onClose={onClose}
              onSave={save.run}
            />
          </>
        ) : (
          <Empty description={t("test.recordNotFound")} />
        )}
      </AsyncBoundary>
    </PagedModal>
  );
}
