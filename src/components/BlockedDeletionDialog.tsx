import PagedModal from "./PagedModal";
import { Alert, Button, Checkbox, List, Space, Typography } from "antd";
import { useState } from "react";
import type { DeletionOutcome } from "../types";
import { useLanguage } from "../i18n/LanguageContext";

/**
 * Explains a delete that did not happen, and offers the destructive alternative.
 *
 * The previous behaviour was to delete the referencing formulation components silently, which
 * changed blends the user had recorded without saying so. Now the record stays, the formulations
 * that use it are named, and removing them anyway is a second, explicit decision — one that says
 * exactly how many components in how many blends it will destroy, and requires the checkbox to be
 * ticked before the button becomes usable.
 */
export default function BlockedDeletionDialog({
  outcome,
  recordName,
  onClose,
  onCascade,
  cascading
}: {
  /** The blocked result, or `undefined` when there is nothing to explain. */
  outcome?: DeletionOutcome;
  /** The record the user tried to delete, shown so the dialog names the right thing. */
  recordName: string;
  onClose: () => void;
  /** Runs the explicit cascading delete. Omit it to offer no destructive option at all. */
  onCascade?: () => void;
  cascading?: boolean;
}) {
  const { t } = useLanguage();
  const [acknowledged, setAcknowledged] = useState(false);

  const open = Boolean(outcome?.blocked);
  const affected = outcome?.blockedBy ?? [];
  const componentTotal = affected.reduce((sum, item) => sum + item.componentCount, 0);

  return (
    <PagedModal
      open={open}
      title={t("delete.blockedTitle")}
      onCancel={() => {
        setAcknowledged(false);
        onClose();
      }}
      afterClose={() => setAcknowledged(false)}
      footer={
        <Space>
          <Button onClick={onClose}>{t("delete.close")}</Button>
          {onCascade ? (
            <Button
              danger
              type="primary"
              // The checkbox is the second acknowledgement. The backend demands one too, and
              // refuses the cascade without it.
              disabled={!acknowledged}
              loading={cascading}
              onClick={onCascade}
            >
              {t("delete.cascadeAction")}
            </Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message={<span translate="no">{recordName}</span>}
          description={t("delete.blockedBody")}
        />
        <Typography.Text strong>{t("delete.blockedListTitle")}</Typography.Text>
        <List
          size="small"
          bordered
          dataSource={affected}
          rowKey={(item) => item.formulationId}
          renderItem={(item) => (
            <List.Item>
              {/* A formulation's name is the user's data, not interface text. */}
              <span translate="no">{item.formulationName || item.formulationId}</span>
              <Typography.Text type="secondary">
                {t("delete.affectedComponents", { count: item.componentCount })}
              </Typography.Text>
            </List.Item>
          )}
        />
        {onCascade ? (
          <>
            <Alert
              type="error"
              showIcon
              message={t("delete.cascadeConfirmTitle", { count: affected.length })}
              description={t("delete.cascadeConfirmBody", {
                components: componentTotal,
                formulations: affected.length
              })}
            />
            <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
              {t("delete.cascadeConfirmCheckbox")}
            </Checkbox>
          </>
        ) : null}
      </Space>
    </PagedModal>
  );
}
