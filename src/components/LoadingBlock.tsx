import { Card, Skeleton } from "antd";
import { useLanguage } from "../i18n/LanguageContext";

/**
 * The placeholder shown while a route's chunk is being read.
 *
 * `role="status"` and a label, so a screen reader announces that something is arriving. A bare
 * skeleton is invisible to assistive technology, which turns a one-second wait into a page that
 * appears to be empty.
 */
export default function LoadingBlock() {
  const { t } = useLanguage();
  return (
    <Card role="status" aria-live="polite" aria-label={t("async.loading")}>
      <Skeleton active paragraph={{ rows: 4 }} />
    </Card>
  );
}
