import { Modal, message } from "antd";
import type { EntityDeletion } from "../types";
import type { MessageKey } from "../i18n/LanguageContext";

/**
 * Reports the outcome of a delete honestly.
 *
 * A cascading delete removes rows and files, and the two halves fail independently. When files are
 * left behind, a plain "Deleted" toast would be a false statement about the user's workspace — so
 * this shows the list instead, along with what it does and does not mean.
 *
 * `t` is passed in rather than read from the hook because this runs from an event handler, often
 * from inside an Ant Design modal callback where no component is rendering.
 */
export function reportDeletion(
  result: EntityDeletion,
  t: (key: MessageKey) => string,
  successKey: MessageKey
): void {
  if (!result.deleted) {
    message.warning(t("deletion.notFound"));
    return;
  }
  if (result.cleanupFailures.length === 0) {
    message.success(t(successKey));
    return;
  }
  Modal.warning({
    title: t("deletion.cleanupTitle"),
    content: (
      <div>
        <p>{t("deletion.cleanupBody")}</p>
        <ul style={{ margin: "8px 0", paddingInlineStart: 20 }}>
          {result.cleanupFailures.map((failure) => (
            // A workspace-relative path is a file name, not interface text.
            <li key={failure} translate="no">
              {failure}
            </li>
          ))}
        </ul>
        <p>{t("deletion.cleanupHint")}</p>
      </div>
    )
  });
}
