import { Alert, Card, Descriptions, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useLanguage } from "../../i18n/LanguageContext";
import type { DesignReadiness, TrainedModel } from "../../lib/api";
import { basisLabelKey } from "../../lib/concentrationPolicy";
import { splitGroupingLabelKeys } from "../../lib/designPolicy";
import { translateMessages } from "../../lib/backendMessages";

/**
 * What the workspace can and cannot do for the chosen target, read from the workspace itself.
 *
 * A workspace with no model is told so, in words, before any candidate exists — and the
 * generation controls stay available, because a structure can be generated and validated
 * without a model. What cannot happen without one is a performance prediction.
 */
export default function ReadinessPanel({
  readiness,
  loading,
  targetLabel
}: {
  readiness?: DesignReadiness;
  loading: boolean;
  targetLabel: string;
}) {
  const { t } = useLanguage();
  if (loading) {
    return <Alert type="info" showIcon message={t("design.readinessLoading")} />;
  }
  if (!readiness) {
    return <Alert type="info" showIcon message={t("design.readinessChooseTarget")} description={t("design.readinessChooseTargetHelp")} />;
  }
  const usable = readiness.models.filter((model) => model.usable);
  const columns: ColumnsType<TrainedModel> = [
    { title: t("design.modelName"), dataIndex: "name", render: (value) => <span translate="no">{value}</span> },
    { title: t("model.samples"), dataIndex: "sampleCount", width: 90 },
    { title: t("design.independentMolecules"), dataIndex: "moleculeCount", width: 120, render: (value) => value ?? 0 },
    {
      title: t("design.validationSupport"),
      width: 220,
      render: (_, model) => (
        <Space size={4} wrap>
          <Tag color={model.validated ? "green" : "gold"}>{model.validated ? t("model.heldOut") : t("model.inSample")}</Tag>
          {model.splitGrouping ? <Tag>{t(splitGroupingLabelKeys[model.splitGrouping] ?? "design.groupingNone")}</Tag> : null}
        </Space>
      )
    },
    {
      title: t("design.trainingScope"),
      width: 260,
      render: (_, model) => {
        const scope = model.datasetScope;
        return (
          <Space size={4} wrap>
            <Tag>{scope?.singleAdditiveOnly ? t("design.scopeSingleAdditive") : t("design.scopeAllFormulations")}</Tag>
            {scope?.testType ? <Tag translate="no">{scope.testType}</Tag> : <Tag>{t("design.scopeAllTestTypes")}</Tag>}
            {scope?.includeConditionFeatures ? <Tag>{t("design.scopeConditionFeatures")}</Tag> : null}
            <Tag>{t(basisLabelKey(model.concentrationBasis))}</Tag>
            {model.usable ? null : <Tag color="red">{t("model.outdatedSchema")}</Tag>}
          </Space>
        );
      }
    }
  ];
  const dataset = readiness.dataset;
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type={readiness.status === "predictionAvailable" ? "success" : "warning"}
        showIcon
        message={readiness.status === "predictionAvailable" ? t("design.readinessPredictionAvailable") : t("design.readinessGenerationOnly")}
        description={
          <Space direction="vertical" size={4}>
            <span>
              {readiness.status === "predictionAvailable"
                ? t("design.readinessPredictionAvailableHelp")
                : t("design.readinessGenerationOnlyHelp")}
            </span>
            {translateMessages(readiness.reasons, t).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </Space>
        }
      />
      <Descriptions size="small" bordered column={4}>
        <Descriptions.Item label={t("design.workspaceMolecules")}>{readiness.workspace.moleculeCount}</Descriptions.Item>
        <Descriptions.Item label={t("design.workspaceDescribed")}>{readiness.workspace.moleculesWithRealDescriptors}</Descriptions.Item>
        <Descriptions.Item label={t("design.workspaceResults")}>{readiness.workspace.performanceResultCount}</Descriptions.Item>
        <Descriptions.Item label={t("design.workspaceCandidates")}>{readiness.workspace.candidateCount}</Descriptions.Item>
        {dataset ? (
          <>
            <Descriptions.Item label={t("design.datasetRowsAll")} span={2}>
              {dataset.unrestricted.rowCount} {t("design.rowsFrom")} {dataset.unrestricted.moleculeCount} {t("design.moleculesWord")}
            </Descriptions.Item>
            <Descriptions.Item label={t("design.datasetRowsSingle")} span={2}>
              {dataset.singleAdditive.rowCount} {t("design.rowsFrom")} {dataset.singleAdditive.moleculeCount} {t("design.moleculesWord")}
            </Descriptions.Item>
          </>
        ) : null}
      </Descriptions>
      <Card size="small" title={`${t("design.modelsForTarget")}: ${targetLabel}`}>
        {readiness.models.length === 0 ? (
          <Typography.Text type="secondary">{t("design.noModelsForTarget")}</Typography.Text>
        ) : (
          <Table scroll={{ x: "max-content" }} size="small" rowKey="id" columns={columns} dataSource={readiness.models} pagination={false} />
        )}
        {usable.length > 0 && !usable.some((model) => model.validated && model.splitGrouping === "linked") ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            {t("design.noLinkedValidationHelp")}
          </Typography.Paragraph>
        ) : null}
      </Card>
    </Space>
  );
}
