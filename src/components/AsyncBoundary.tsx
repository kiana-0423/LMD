import { Alert, Button, Skeleton, Space } from "antd";
import type { ReactNode } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { describeBackendError } from "../lib/backendErrors";

/**
 * Loading, failure and retry, rendered the same way on every page.
 *
 * Each screen used to decide for itself what to show while a command was running, and most of them
 * decided to show nothing. A failed load then looked identical to an empty workspace: no spinner,
 * no message, an empty table. This makes the three states distinct and gives the failed one a
 * button, because a load that cannot be retried leaves a user with nothing to do but restart the
 * application.
 *
 * The error keeps its backend code, so the sentence a user reads is in their language and the
 * English diagnostic is shown beside it rather than instead of it.
 */
export default function AsyncBoundary({
  loading,
  error,
  onRetry,
  children,
  rows = 4
}: {
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
  /** How tall the skeleton is, so a small panel does not flash a full-page placeholder. */
  rows?: number;
}) {
  const { t } = useLanguage();

  if (error) {
    const { summary, detail } = describeBackendError(error, t);
    return (
      <Alert
        type="error"
        showIcon
        message={t("async.failedTitle")}
        description={
          <Space direction="vertical" size={8}>
            <span>{summary}</span>
            {/* The backend's own words: a path, an id, a SQLite message. Not translated, because
                translating it would mean translating the user's own data. */}
            {detail ? <span translate="no">{detail}</span> : null}
            {onRetry ? (
              <Button size="small" onClick={onRetry}>
                {t("async.retry")}
              </Button>
            ) : null}
          </Space>
        }
      />
    );
  }

  // Only while there is nothing to show. A refresh after a write keeps the previous rows on screen
  // instead of replacing a populated table with a skeleton.
  if (loading) {
    return <Skeleton active paragraph={{ rows }} aria-label={t("async.loading")} />;
  }

  return <>{children}</>;
}
