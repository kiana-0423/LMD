import { Alert, Card, Collapse, Descriptions, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useLanguage } from "../../i18n/LanguageContext";
import type { AssessedCandidate, AssessmentRun, ConditionHandling } from "../../lib/api";
import { describeMessage, translateMessages } from "../../lib/backendMessages";
import {
  assessmentStatusColor,
  assessmentStatusHelpKeys,
  assessmentStatusLabelKeys,
  conditionHandlingLabelKeys,
  conditionNameKeys,
  coverageStatusLabelKeys,
  domainStatusLabelKeys,
  validationSupportLabelKeys
} from "../../lib/designPolicy";

/**
 * One assessment run: the model's own evidence once, then each candidate's status with the
 * reasons behind it.
 *
 * Four assessments are shown separately because they fail separately: a structure can be
 * compliant while the model cannot describe it; a prediction can be computable while the
 * candidate lies outside every training range; a model can be validated on repeat formulations
 * and still say nothing about unseen molecules. A single "confidence" would hide which one.
 */
export default function AssessmentPanel({ run, metricLabel }: { run: AssessmentRun; metricLabel: (column: string) => string }) {
  const { t } = useLanguage();
  const handlingRows = (Object.keys(run.conditionHandling) as (keyof ConditionHandling)[]).map((key) => ({
    key,
    condition: t(conditionNameKeys[key]),
    handling: t(conditionHandlingLabelKeys[run.conditionHandling[key]])
  }));
  const support = run.validationSupport;

  function renderReasons(items: AssessedCandidate["assessment"]["reasons"]) {
    if (items.length === 0) return <Typography.Text type="secondary">{t("design.noReasons")}</Typography.Text>;
    return (
      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
        {items.map((reason, index) => {
          const explained = describeMessage(reason, t);
          return (
            <li key={`${reason.code ?? "reason"}-${index}`}>
              {explained.text}
              {explained.detail && explained.detail !== explained.text ? (
                <div>
                  <Typography.Text type="secondary">
                    {t("ui.diagnosticDetail")}: <span translate="no">{explained.detail}</span>
                  </Typography.Text>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const columns: ColumnsType<AssessedCandidate> = [
    {
      title: t("design.candidate"),
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong translate="no">
            {item.candidateName}
          </Typography.Text>
          <Typography.Text type="secondary" translate="no" style={{ wordBreak: "break-all" }}>
            {item.smilesCanonical}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: t("design.assessmentStatus"),
      width: 260,
      render: (_, item) => (
        <Space direction="vertical" size={2}>
          <Tag color={assessmentStatusColor(item.status)}>{t(assessmentStatusLabelKeys[item.status])}</Tag>
          <Typography.Text type="secondary">{t(assessmentStatusHelpKeys[item.status])}</Typography.Text>
        </Space>
      )
    },
    {
      title: metricLabel(run.target),
      width: 200,
      render: (_, item) =>
        item.predictedValue === null || item.predictedValue === undefined ? (
          <Typography.Text type="secondary">{t("design.noPredictedValue")}</Typography.Text>
        ) : (
          <span translate="no">{`${item.predictedValue.toFixed(5)} ${run.unit ?? ""}`.trim()}</span>
        )
    }
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Descriptions size="small" bordered column={3}>
        <Descriptions.Item label={t("model.predictedWith")}>
          <span translate="no">{run.modelName}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t("design.validationSupport")}>
          {t(validationSupportLabelKeys[support.status] ?? "design.supportNone")}
        </Descriptions.Item>
        <Descriptions.Item label={t("design.independentMolecules")}>{support.moleculeCount}</Descriptions.Item>
        {support.metrics ? (
          <>
            <Descriptions.Item label={t("model.meanAbsoluteError")}>
              <span translate="no">{`${support.metrics.mae.toFixed(5)} ${run.unit ?? ""}`.trim()}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("model.rootMeanSquaredError")}>
              <span translate="no">{`${support.metrics.rmse.toFixed(5)} ${run.unit ?? ""}`.trim()}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t("design.heldOutMolecules")}>{support.metrics.molecule_count ?? "-"}</Descriptions.Item>
          </>
        ) : (
          <Descriptions.Item label={t("model.score")} span={3}>
            {t("design.supportNone")}
          </Descriptions.Item>
        )}
        <Descriptions.Item label={t("design.counts")} span={3}>
          <Space size={8}>
            <Tag color="green">{`${t("design.statusSupported")}: ${run.counts.supported}`}</Tag>
            <Tag color="gold">{`${t("design.statusExploratory")}: ${run.counts.exploratory}`}</Tag>
            <Tag color="red">{`${t("design.statusUnavailable")}: ${run.counts.unavailable}`}</Tag>
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Card size="small" title={t("design.conditionHandlingTitle")}>
        <Typography.Paragraph type="secondary">{t("design.conditionHandlingHelp")}</Typography.Paragraph>
        <Table
          scroll={{ x: "max-content" }}
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={handlingRows}
          columns={[
            { title: t("design.condition"), dataIndex: "condition" },
            { title: t("design.handling"), dataIndex: "handling" }
          ]}
        />
      </Card>
      {run.modelReasons.length > 0 ? (
        <Alert type="warning" showIcon message={t("design.modelReasonsTitle")} description={renderReasons(run.modelReasons)} />
      ) : null}
      {run.warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t("design.sidecarWarnings")}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {translateMessages(run.warnings, t).map((warning) => (
                <li key={warning} translate="no">
                  {warning}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
      <Table
        scroll={{ x: "max-content" }}
        size="small"
        rowKey="predictionId"
        columns={columns}
        dataSource={run.items}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (item) => {
            const assessment = item.assessment;
            const evidence = assessment.domain.evidence;
            const coverage = assessment.conditionCoverage;
            return (
              <Collapse
                size="small"
                items={[
                  {
                    key: "reasons",
                    label: t("design.reasons"),
                    children: renderReasons(assessment.reasons)
                  },
                  {
                    key: "structural",
                    label: `${t("design.structuralCompliance")}: ${
                      assessment.structural.status === "compliant" ? t("design.structurallyCompliant") : t("design.structurallyRejected")
                    }`,
                    children: (
                      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                        {assessment.structural.findings.map((finding) => (
                          <li key={finding.rule}>
                            <Tag color={finding.ok ? "green" : "red"} translate="no">
                              {finding.rule}
                            </Tag>{" "}
                            <span translate="no">{finding.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  },
                  {
                    key: "readiness",
                    label: `${t("design.predictionReadiness")}: ${
                      assessment.readiness.status === "ready" ? t("design.ready") : t("design.statusUnavailable")
                    }`,
                    children: renderReasons(assessment.readiness.reasons)
                  },
                  {
                    key: "domain",
                    label: `${t("design.applicabilityDomain")}: ${t(domainStatusLabelKeys[assessment.domain.status] ?? "design.domainUnknown")}`,
                    children: evidence ? (
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {evidence.feature_coverage ? (
                          <span>
                            {t("design.descriptorCoverage")}: {evidence.feature_coverage.compared_features - evidence.feature_coverage.outside_range_count}/
                            {evidence.feature_coverage.compared_features} {t("design.withinTrainingRange")}
                            {evidence.feature_coverage.outside_range.length > 0 ? (
                              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                                {evidence.feature_coverage.outside_range.map((entry) => (
                                  <li key={entry.feature} translate="no">
                                    {entry.feature}: {entry.value.toPrecision(4)} ({entry.training_min.toPrecision(4)} – {entry.training_max.toPrecision(4)})
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </span>
                        ) : (
                          <span>{t("design.domainUnknown")}</span>
                        )}
                        {evidence.nearest_training ? (
                          <span>
                            {t("design.nearestTraining")} ({t("design.similarityIsEvidence")}):
                            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                              {evidence.nearest_training.nearest.map((neighbour) => (
                                <li key={neighbour.id} translate="no">
                                  {neighbour.label || neighbour.id} — {neighbour.similarity.toFixed(3)}
                                </li>
                              ))}
                            </ul>
                            <Typography.Text type="secondary" translate="no">
                              {evidence.nearest_training.method}
                            </Typography.Text>
                          </span>
                        ) : null}
                        {evidence.model_disagreement ? (
                          <span>
                            {t("design.modelDisagreement")}:{" "}
                            <span translate="no">
                              {`σ ${evidence.model_disagreement.std.toPrecision(4)} (${evidence.model_disagreement.min.toPrecision(4)} – ${evidence.model_disagreement.max.toPrecision(4)}; ${t("design.memberCount")} ${evidence.model_disagreement.member_count})`}
                            </span>{" "}
                            <Typography.Text type="secondary">{t("design.disagreementIsEvidence")}</Typography.Text>
                          </span>
                        ) : (
                          <Typography.Text type="secondary">{t("design.noDisagreementEvidence")}</Typography.Text>
                        )}
                      </Space>
                    ) : (
                      <span>{t("design.domainUnknown")}</span>
                    )
                  },
                  {
                    key: "coverage",
                    label: t("design.conditionCoverage"),
                    children: coverage ? (
                      <Descriptions size="small" column={2}>
                        <Descriptions.Item label={t("design.testType")}>{t(coverageStatusLabelKeys[coverage.testType.status])}</Descriptions.Item>
                        <Descriptions.Item label={t("formulation.baseOil")}>{t(coverageStatusLabelKeys[coverage.baseOil.status])}</Descriptions.Item>
                        <Descriptions.Item label={t("model.concentration")}>{t(coverageStatusLabelKeys[coverage.concentration.status])}</Descriptions.Item>
                        <Descriptions.Item label={t("design.conditionTemperature")}>{t(coverageStatusLabelKeys[coverage.temperature.status])}</Descriptions.Item>
                        <Descriptions.Item label={t("design.conditionLoad")}>{t(coverageStatusLabelKeys[coverage.load.status])}</Descriptions.Item>
                        <Descriptions.Item label={t("design.otherComponents")}>{t("design.handlingRecordedOnly")}</Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <span>{t("design.statusUnavailable")}</span>
                    )
                  },
                  {
                    key: "synthesis",
                    label: `${t("design.synthesisFeasibility")}: ${t("design.notAssessed")}`,
                    children: <Typography.Text type="secondary">{t("design.synthesisNotAssessedHelp")}</Typography.Text>
                  }
                ]}
              />
            );
          }
        }}
      />
    </Space>
  );
}
