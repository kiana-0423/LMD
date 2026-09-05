import { Button, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useLanguage } from "../../i18n/LanguageContext";
import type { DesignCandidate } from "../../lib/api";
import {
  assessmentStatusColor,
  assessmentStatusLabelKeys,
  chemicalClassLabelKeys,
  verificationLabelKeys
} from "../../lib/designPolicy";

/**
 * The candidate collection, with the two facts a reader most needs beside each structure: whether
 * the workspace already holds it, and what the latest assessment concluded.
 *
 * Rows are ordered as the backend returned them. Nothing here sorts by a predicted value: a
 * candidate with no prediction is not "worse" than one with a number, and a ranking by
 * exploratory extrapolations would present a guess as an order.
 */
export default function CandidateTable({
  candidates,
  selectedIds,
  onSelect,
  onOpen,
  onPromote,
  metricLabel
}: {
  candidates: DesignCandidate[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (candidate: DesignCandidate) => void;
  onPromote: (candidate: DesignCandidate) => void;
  metricLabel: (column: string) => string;
}) {
  const { t } = useLanguage();
  const columns: ColumnsType<DesignCandidate> = [
    {
      title: t("design.structure"),
      width: 170,
      render: (_, candidate) =>
        candidate.structureSvg ? (
          <img
            style={{ width: 160, height: 100, objectFit: "contain" }}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(candidate.structureSvg)}`}
            alt={t("ui.2dMolecularStructure")}
          />
        ) : (
          <Typography.Text type="secondary">{t("design.noPreview")}</Typography.Text>
        )
    },
    {
      title: t("design.candidate"),
      render: (_, candidate) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong translate="no">
            {candidate.name}
          </Typography.Text>
          <Typography.Text type="secondary" translate="no" style={{ wordBreak: "break-all" }}>
            {candidate.smilesCanonical}
          </Typography.Text>
          <Typography.Text type="secondary" translate="no">
            {candidate.formula} · {candidate.molecularWeight?.toFixed(2) ?? ""}
          </Typography.Text>
          <Space size={2} wrap>
            {candidate.chemicalClasses.map((label) => (
              <Tag key={label}>{chemicalClassLabelKeys[label] ? t(chemicalClassLabelKeys[label]) : <span translate="no">{label}</span>}</Tag>
            ))}
          </Space>
        </Space>
      )
    },
    {
      title: t("design.libraryStatus"),
      width: 180,
      render: (_, candidate) => (
        <Space direction="vertical" size={2}>
          {candidate.promotedMoleculeId ? (
            <Tag color="blue">{t("design.promoted")}</Tag>
          ) : candidate.existingMoleculeId ? (
            <Tag color="geekblue">
              {t("design.alreadyInLibrary")}: <span translate="no">{candidate.existingMoleculeName}</span>
            </Tag>
          ) : (
            <Tag>{t("design.notInWorkspace")}</Tag>
          )}
          <Tag color={candidate.validationStatus === "valid" ? "green" : "red"}>
            {candidate.validationStatus === "valid" ? t("design.structurallyCompliant") : t("design.structurallyRejected")}
          </Tag>
          <Tag>{t(verificationLabelKeys[candidate.verificationStatus] ?? "design.verificationNotVerified")}</Tag>
        </Space>
      )
    },
    {
      title: t("design.latestAssessment"),
      width: 220,
      render: (_, candidate) => {
        const latest = candidate.latestAssessment;
        if (!latest) return <Typography.Text type="secondary">{t("design.notAssessed")}</Typography.Text>;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={assessmentStatusColor(latest.status)}>{t(assessmentStatusLabelKeys[latest.status])}</Tag>
            {latest.predictedValue !== null && latest.predictedValue !== undefined ? (
              <span>
                {metricLabel(latest.target)}: <span translate="no">{`${latest.predictedValue.toFixed(5)} ${latest.unit ?? ""}`.trim()}</span>
              </span>
            ) : (
              <Typography.Text type="secondary">{t("design.noPredictedValue")}</Typography.Text>
            )}
            <Typography.Text type="secondary" translate="no">
              {latest.modelName}
            </Typography.Text>
          </Space>
        );
      }
    },
    {
      title: t("ui.actions"),
      width: 200,
      render: (_, candidate) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => onOpen(candidate)}>
            {t("design.details")}
          </Button>
          <Button size="small" disabled={Boolean(candidate.promotedMoleculeId) || candidate.validationStatus !== "valid"} onClick={() => onPromote(candidate)}>
            {t("design.promote")}
          </Button>
        </Space>
      )
    }
  ];
  return (
    <Table
      scroll={{ x: "max-content" }}
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={candidates}
      pagination={{ pageSize: 10 }}
      rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => onSelect(keys as string[]) }}
    />
  );
}
