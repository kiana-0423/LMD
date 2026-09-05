import PagedModal from "../../components/PagedModal";
import WorkspaceTabs from "../../components/WorkspaceTabs";
import { Alert, Button, Card, Descriptions, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import {
  assessDesignCandidates,
  deliverExport,
  describeExport,
  exportDesignCandidates,
  getDesignReadiness,
  listBaseOils,
  listDesignCandidates,
  listDesignTemplates,
  listExperiments,
  listPerformanceMetrics,
  promoteDesignCandidate,
  runDesignGeneration,
  updateDesignCandidateVerification,
  type ApplicationContext,
  type AssessmentRun,
  type DesignCandidate,
  type DesignReadiness,
  type DesignTemplateCatalogue,
  type GenerationResult,
  type VerificationStatus
} from "../../lib/api";
import { backendErrorText, describeBackendError } from "../../lib/backendErrors";
import {
  additiveFunctionLabelKeys,
  additiveFunctionTags,
  moleculeCategories,
  moleculeCategoryLabelKeys
} from "../../lib/constants";
import { buildConcentration, concentrationPolicy } from "../../lib/concentrationPolicy";
import {
  assessmentStatusColor,
  assessmentStatusLabelKeys,
  chemicalClassLabelKeys,
  modelUsesConditions
} from "../../lib/designPolicy";
import { isTauriRuntime } from "../../lib/tauri";
import type { BaseOil } from "../../types";
import AssessmentPanel from "./AssessmentPanel";
import CandidateDetailDrawer from "./CandidateDetailDrawer";
import CandidateTable from "./CandidateTable";
import DesignRequestForm from "./DesignRequestForm";
import ReadinessPanel from "./ReadinessPanel";
import {
  DEFAULT_CHEMICAL_CLASS,
  DEFAULT_CONTEXT,
  DEFAULT_TARGET,
  buildDesignRequest,
  cleanContext,
  type ChemicalClassState,
  type TargetState
} from "./designRequest";

/**
 * Molecular design: generate candidates inside an explicit chemical class, keep them apart from
 * the library, and assess a prediction for each against one model in one application context.
 *
 * The page never ranks candidates by predicted value and never fills in a score where there is
 * none. When the workspace holds no usable model the generation half works and the prediction
 * half says why it cannot.
 */
export default function MolecularDesignPage() {
  const { t } = useLanguage();
  const desktop = isTauriRuntime();

  const [catalogue, setCatalogue] = useState<DesignTemplateCatalogue>();
  const [catalogueError, setCatalogueError] = useState<string>();
  const [metrics, setMetrics] = useState<{ column: string; labelCode?: string; label: string; unit: string }[]>([]);
  const [baseOils, setBaseOils] = useState<BaseOil[]>([]);
  const [testTypes, setTestTypes] = useState<string[]>([]);

  const [requestName, setRequestName] = useState("");
  const [chemicalClass, setChemicalClass] = useState<ChemicalClassState>(DEFAULT_CHEMICAL_CLASS);
  const [target, setTarget] = useState<TargetState>(DEFAULT_TARGET);
  const [context, setContext] = useState<ApplicationContext>(DEFAULT_CONTEXT);

  const [readiness, setReadiness] = useState<DesignReadiness>();
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string>();

  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<GenerationResult>();
  const [requestInfoOpen, setRequestInfoOpen] = useState(false);
  const [generationDetailsOpen, setGenerationDetailsOpen] = useState(false);
  const [generationError, setGenerationError] = useState<string>();
  const [candidates, setCandidates] = useState<DesignCandidate[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [candidatesError, setCandidatesError] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openCandidate, setOpenCandidate] = useState<DesignCandidate>();
  const [promoting, setPromoting] = useState<DesignCandidate>();
  const [promoteName, setPromoteName] = useState("");
  const [promoteCategory, setPromoteCategory] = useState("candidate");
  const [promoteTags, setPromoteTags] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<AssessmentRun>();
  const [assessmentError, setAssessmentError] = useState<string>();

  const readinessVersion = useRef(0);

  const metricLabel = useCallback(
    (column: string) => {
      const metric = metrics.find((item) => item.column === column);
      if (metric?.labelCode) return t(metric.labelCode as MessageKey);
      return metric?.label ?? column;
    },
    [metrics, t]
  );

  useEffect(() => {
    if (!desktop) return;
    listDesignTemplates()
      .then(setCatalogue)
      .catch((error: unknown) => setCatalogueError(error instanceof Error ? error.message : String(error)));
    listPerformanceMetrics()
      .then(setMetrics)
      .catch(() => setMetrics([]));
    listBaseOils()
      .then(setBaseOils)
      .catch(() => setBaseOils([]));
    listExperiments()
      .then((experiments) =>
        setTestTypes([...new Set(experiments.map((item) => item.testType).filter((value) => Boolean(value)))].sort())
      )
      .catch(() => setTestTypes([]));
  }, [desktop]);

  const loadCandidates = useCallback(async () => {
    if (!desktop) return;
    try {
      const page = await listDesignCandidates({ page: 1, pageSize: 200, includeSvg: true });
      setCandidates(page.items);
      setCandidatesTotal(page.total);
      setCandidatesError(undefined);
    } catch (error) {
      setCandidatesError(error instanceof Error ? error.message : String(error));
    }
  }, [desktop]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  useEffect(() => {
    if (!desktop) return;
    const version = (readinessVersion.current += 1);
    setReadinessLoading(true);
    setReadinessError(undefined);
    setSelectedModelId(undefined);
    setAssessment(undefined);
    getDesignReadiness(target.targetMetric)
      .then((next) => {
        if (version !== readinessVersion.current) return;
        setReadiness(next);
        setSelectedModelId(next.models.find((model) => model.usable)?.id);
      })
      .catch((error: unknown) => {
        if (version !== readinessVersion.current) return;
        setReadinessError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (version === readinessVersion.current) setReadinessLoading(false);
      });
  }, [desktop, target.targetMetric]);

  const usableModels = useMemo(() => (readiness?.models ?? []).filter((model) => model.usable), [readiness]);
  const selectedModel = usableModels.find((model) => model.id === selectedModelId);
  const policy = concentrationPolicy(selectedModel?.concentrationBasis);
  const modelNeedsConditions = modelUsesConditions(selectedModel);

  async function handleGenerate() {
    if (!chemicalClass.templateId && chemicalClass.seeds.length === 0) {
      message.warning(t("design.seedRequiredWithoutTemplate"));
      return;
    }
    if (chemicalClass.seeds.some((seed) => (seed.source === "library" ? !seed.moleculeId : !seed.smiles?.trim()))) {
      message.warning(t("design.seedIncomplete"));
      return;
    }
    setGenerating(true);
    setGenerationError(undefined);
    try {
      const result = await runDesignGeneration(buildDesignRequest(chemicalClass, target, context, requestName.trim()));
      setGeneration(result);
      setSelectedIds(result.candidates.map((candidate) => candidate.id));
      await loadCandidates();
      message.success(`${t("design.generated")}: ${result.candidateCount}`);
    } catch (error) {
      setGeneration(undefined);
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  async function handleAssess() {
    if (!selectedModel || !policy) {
      message.warning(t("design.noModelSelected"));
      return;
    }
    if (selectedIds.length === 0) {
      message.warning(t("design.selectCandidatesFirst"));
      return;
    }
    const checked = buildConcentration(policy, {
      value: context.concentration ?? null,
      unit: context.concentrationUnit
    });
    if (!checked.ok) {
      message.warning(t(checked.messageKey));
      return;
    }
    if (modelNeedsConditions && (context.temperatureValue === undefined || context.loadValue === undefined)) {
      message.warning(t("design.conditionsRequiredForModel"));
      return;
    }
    setAssessing(true);
    setAssessmentError(undefined);
    try {
      const run = await assessDesignCandidates({
        candidateIds: selectedIds,
        modelId: selectedModel.id,
        // The concentration goes exactly as the basis policy built it: a `none` model gets none.
        context: cleanContext({ ...context, ...checked.payload, concentration: checked.payload.concentration })
      });
      setAssessment(run);
      await loadCandidates();
    } catch (error) {
      setAssessment(undefined);
      setAssessmentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAssessing(false);
    }
  }

  async function handleExport() {
    if (selectedIds.length === 0) {
      message.warning(t("design.selectCandidatesFirst"));
      return;
    }
    try {
      const result = await exportDesignCandidates(selectedIds);
      deliverExport(result);
      message.success(
        describeExport(result, t("design.exportCandidates"), {
          savedTo: t("ui.exportedRowsTo"),
          exported: t("ui.exportedShort")
        })
      );
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  async function handlePromote() {
    if (!promoting) return;
    try {
      const result = await promoteDesignCandidate({
        candidateId: promoting.id,
        name: promoteName.trim() || undefined,
        category: promoteCategory,
        tags: promoteTags
      });
      message.success(`${t("design.promotedAs")}: ${result.moleculeName}`);
      setPromoting(undefined);
      await loadCandidates();
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  async function handleVerification(candidate: DesignCandidate, status: VerificationStatus, notes: string) {
    try {
      const result = await updateDesignCandidateVerification({ candidateId: candidate.id, status, notes });
      setOpenCandidate(result.candidate);
      await loadCandidates();
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  const describedGenerationError = generationError ? describeBackendError(generationError, t) : undefined;
  const describedAssessmentError = assessmentError ? describeBackendError(assessmentError, t) : undefined;
  const describedReadinessError = readinessError ? describeBackendError(readinessError, t) : undefined;
  const describedCatalogueError = catalogueError ? describeBackendError(catalogueError, t) : undefined;
  const describedCandidatesError = candidatesError ? describeBackendError(candidatesError, t) : undefined;
  const selectedCandidates = candidates.filter((candidate) => selectedIds.includes(candidate.id));
  const targetLabel = target.targetMetric ? metricLabel(target.targetMetric) : t("design.noTargetChosen");

  if (!desktop) {
    return (
      <div className="page-grid workspace-page">
        <PageHeader title={t("design.title")} description={t("design.description")} />
        <Alert
          type="warning"
          showIcon
          message={t("design.desktopOnlyTitle")}
          description={t("design.desktopOnlyBody")}
        />
      </div>
    );
  }

  return (
    <div className="page-grid workspace-page">
      <PageHeader title={t("design.title")} description={t("design.description")} />
      <WorkspaceTabs
        unpagedKeys={["0"]}
        labels={[
          t("design.requestTitle"),
          t("design.readinessTitle"),
          t("design.candidatesTitle"),
          t("design.assessTitle")
        ]}
      >
        <section className="design-request-workspace">
          <div className="design-request-toolbar">
            <Input
              style={{ maxWidth: 420 }}
              value={requestName}
              placeholder={t("design.requestName")}
              aria-label={t("design.requestName")}
              onChange={(event) => setRequestName(event.target.value)}
            />
            <Space size={12} wrap>
              <Button
                type="primary"
                loading={generating}
                disabled={chemicalClass.templateId ? !catalogue : chemicalClass.seeds.length === 0}
                onClick={handleGenerate}
              >
                {t("design.generate")}
              </Button>
              {generating ? <Typography.Text type="secondary">{t("design.generating")}</Typography.Text> : null}
            </Space>
            <Button aria-label={t("design.scopeTitle")} onClick={() => setRequestInfoOpen(true)}>
              {t("ui.description")}
            </Button>
            {generation || describedGenerationError ? (
              <Button danger={Boolean(describedGenerationError)} onClick={() => setGenerationDetailsOpen(true)}>
                {t(describedGenerationError ? "design.generationFailed" : "design.generationDetails")}
              </Button>
            ) : null}
          </div>
          <DesignRequestForm
            catalogue={catalogue}
            catalogueError={describedCatalogueError}
            chemicalClass={chemicalClass}
            onChemicalClass={setChemicalClass}
            target={target}
            onTarget={setTarget}
            context={context}
            onContext={setContext}
            metrics={metrics.map((metric) => ({ column: metric.column, label: metricLabel(metric.column) }))}
            baseOils={baseOils}
            testTypes={testTypes}
          />
          <PagedModal
            open={requestInfoOpen}
            title={t("design.scopeTitle")}
            footer={null}
            onCancel={() => setRequestInfoOpen(false)}
          >
            <Alert type="info" showIcon message={t("design.scopeTitle")} description={t("design.scopeBody")} />
          </PagedModal>
          <PagedModal
            open={generationDetailsOpen}
            title={t("design.generationDetails")}
            footer={null}
            onCancel={() => setGenerationDetailsOpen(false)}
          >
            {describedGenerationError ? (
              <Alert
                type="error"
                showIcon
                message={t("design.generationFailed")}
                description={
                  <Space direction="vertical" size={4}>
                    <span>{describedGenerationError.summary}</span>
                    <span translate="no">{describedGenerationError.detail}</span>
                  </Space>
                }
                action={<Button onClick={handleGenerate}>{t("ui.retry")}</Button>}
              />
            ) : null}
            {generation ? (
              <Descriptions size="small" bordered column={4}>
                <Descriptions.Item label={t("design.generated")}>{generation.candidateCount}</Descriptions.Item>
                <Descriptions.Item label={t("design.enumerated")}>{generation.enumeratedTotal ?? "-"}</Descriptions.Item>
                <Descriptions.Item label={t("design.duplicatesRemoved")}>{generation.duplicateCount}</Descriptions.Item>
                <Descriptions.Item label={t("design.alreadyInLibrary")}>
                  {generation.existingInLibraryCount}
                </Descriptions.Item>
                <Descriptions.Item label={t(generation.template ? "design.substituentsUsed" : "design.fragmentsCollected")}>
                  {generation.substituentCount}
                </Descriptions.Item>
                <Descriptions.Item label={t("design.substituentsRejected")}>
                  {generation.rejectedSubstituents.length}
                </Descriptions.Item>
                <Descriptions.Item label={t("design.structuresRejected")}>
                  {generation.rejectedStructureCount}
                </Descriptions.Item>
                <Descriptions.Item label={t("design.generationJob")}>
                  <span translate="no">{generation.jobId}</span>
                </Descriptions.Item>
                <Descriptions.Item label={t("design.generatorVersion")} span={2}>
                  <span translate="no">{generation.generatorVersion}</span>
                </Descriptions.Item>
                <Descriptions.Item label={t("design.randomSeed")} span={2}>
                  <span translate="no">{generation.randomSeed ?? "-"}</span>
                </Descriptions.Item>
                {generation.seedReports.length > 0 ? (
                  <Descriptions.Item label={t("design.seedReports")} span={4}>
                    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                      {generation.seedReports.map((report) => (
                        <li key={report.id}>
                          <span translate="no">{report.id}</span>: {t("design.seedAccepted")} {report.accepted}
                          {report.error ? (
                            <span>
                              {" "}
                              — <span translate="no">{report.error}</span>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </Descriptions.Item>
                ) : null}
                {generation.warnings.length > 0 ? (
                  <Descriptions.Item label={t("design.sidecarWarnings")} span={4}>
                    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                      {generation.warnings.map((warning) => (
                        <li key={warning} translate="no">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </Descriptions.Item>
                ) : null}
              </Descriptions>
            ) : null}
          </PagedModal>
        </section>
        <Card title={t("design.readinessTitle")}>
          {describedReadinessError ? (
            <Alert
              type="error"
              showIcon
              message={t("ui.pageFailedToLoad")}
              description={
                <Space direction="vertical" size={4}>
                  <span>{describedReadinessError.summary}</span>
                  <span translate="no">{describedReadinessError.detail}</span>
                </Space>
              }
            />
          ) : (
            <ReadinessPanel
              readiness={target.targetMetric ? readiness : undefined}
              loading={readinessLoading}
              targetLabel={targetLabel}
            />
          )}
        </Card>
        <Card
          title={`${t("design.candidatesTitle")} (${candidatesTotal})`}
          extra={
            <Space size={8} wrap>
              <Button disabled={selectedIds.length < 2} onClick={() => setComparing(true)}>
                {t("design.compare")}
              </Button>
              <Button disabled={selectedIds.length === 0} onClick={handleExport}>
                {t("design.exportCandidates")}
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text type="secondary">{t("design.candidatesHelp")}</Typography.Text>
            {describedCandidatesError ? (
              <Alert
                type="error"
                showIcon
                message={describedCandidatesError.summary}
                description={<span translate="no">{describedCandidatesError.detail}</span>}
              />
            ) : null}
            {candidates.length === 0 ? (
              <Alert
                type="info"
                showIcon
                message={t("design.noCandidatesTitle")}
                description={t("design.noCandidatesBody")}
              />
            ) : (
              <CandidateTable
                candidates={candidates}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onOpen={setOpenCandidate}
                onPromote={(candidate) => {
                  setPromoting(candidate);
                  setPromoteName(candidate.name);
                  setPromoteCategory("candidate");
                  setPromoteTags([]);
                }}
                metricLabel={metricLabel}
              />
            )}
          </Space>
        </Card>
        <Card title={t("design.assessTitle")}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text type="secondary">{t("design.assessHelp")}</Typography.Text>
            {!target.targetMetric ? (
              <Alert
                type="info"
                showIcon
                message={t("design.readinessChooseTarget")}
                description={t("design.readinessChooseTargetHelp")}
              />
            ) : usableModels.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message={t("design.predictionUnavailableTitle")}
                description={t("design.predictionUnavailableBody")}
              />
            ) : (
              <Space size={12} wrap>
                <Select
                  style={{ width: 320, maxWidth: "100%" }}
                  value={selectedModelId}
                  aria-label={t("model.selectModel")}
                  onChange={setSelectedModelId}
                  options={usableModels.map((model) => ({
                    value: model.id,
                    label: <span translate="no">{model.name}</span>
                  }))}
                />
                {policy && !policy.needsValue ? <Tag>{t("concentration.noneTitle")}</Tag> : null}
                {modelNeedsConditions ? <Tag color="blue">{t("design.modelUsesConditions")}</Tag> : null}
                <Button
                  type="primary"
                  loading={assessing}
                  disabled={!selectedModel || selectedIds.length === 0}
                  onClick={handleAssess}
                >
                  {`${t("design.assessSelected")} (${selectedIds.length})`}
                </Button>
              </Space>
            )}
            {describedAssessmentError ? (
              <Alert
                type="error"
                showIcon
                message={t("design.assessmentFailed")}
                description={
                  <Space direction="vertical" size={4}>
                    <span>{describedAssessmentError.summary}</span>
                    <span translate="no">{describedAssessmentError.detail}</span>
                  </Space>
                }
              />
            ) : null}
            {assessment ? <AssessmentPanel run={assessment} metricLabel={metricLabel} /> : null}
          </Space>
        </Card>
      </WorkspaceTabs>

      <CandidateDetailDrawer
        candidate={openCandidate}
        onClose={() => setOpenCandidate(undefined)}
        onVerification={handleVerification}
      />

      <PagedModal
        open={Boolean(promoting)}
        title={t("design.promoteTitle")}
        okText={t("design.promote")}
        cancelText={t("ui.cancel")}
        onOk={handlePromote}
        onCancel={() => setPromoting(undefined)}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Typography.Text>{t("design.promoteHelp")}</Typography.Text>
          <Input
            value={promoteName}
            placeholder={t("design.promoteName")}
            aria-label={t("design.promoteName")}
            onChange={(event) => setPromoteName(event.target.value)}
          />
          <Select
            style={{ width: "100%" }}
            value={promoteCategory}
            aria-label={t("design.promoteCategory")}
            onChange={setPromoteCategory}
            options={moleculeCategories.map((category) => ({
              value: category,
              label: t(moleculeCategoryLabelKeys[category])
            }))}
          />
          <Select
            mode="multiple"
            style={{ width: "100%" }}
            value={promoteTags}
            placeholder={t("design.promoteTags")}
            aria-label={t("design.promoteTags")}
            onChange={setPromoteTags}
            options={additiveFunctionTags.map((tag) => ({ value: tag, label: t(additiveFunctionLabelKeys[tag]) }))}
          />
          <Typography.Text type="secondary">{t("design.promoteTagsHelp")}</Typography.Text>
        </Space>
      </PagedModal>

      <PagedModal
        open={comparing}
        width={1100}
        title={t("design.compareTitle")}
        footer={null}
        onCancel={() => setComparing(false)}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: true }}
          dataSource={selectedCandidates}
          columns={[
            {
              title: t("design.structure"),
              width: 150,
              render: (_, candidate: DesignCandidate) =>
                candidate.structureSvg ? (
                  <img
                    style={{ width: 140, height: 90, objectFit: "contain" }}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(candidate.structureSvg)}`}
                    alt={t("ui.2dMolecularStructure")}
                  />
                ) : null
            },
            { title: t("design.candidate"), dataIndex: "name", render: (value) => <span translate="no">{value}</span> },
            {
              title: t("design.formula"),
              dataIndex: "formula",
              render: (value) => <span translate="no">{value}</span>
            },
            {
              title: t("ui.molecularWeight"),
              dataIndex: "molecularWeight",
              render: (value: number | null) => <span translate="no">{value?.toFixed(2) ?? ""}</span>
            },
            {
              title: t("design.chemicalClasses"),
              dataIndex: "chemicalClasses",
              render: (value: string[]) =>
                value.map((label) => (
                  <Tag key={label}>
                    {chemicalClassLabelKeys[label] ? (
                      t(chemicalClassLabelKeys[label])
                    ) : (
                      <span translate="no">{label}</span>
                    )}
                  </Tag>
                ))
            },
            {
              title: t("design.substituents"),
              dataIndex: "substituents",
              render: (value: DesignCandidate["substituents"]) => (
                <span translate="no">{value.map((item) => item.name).join(", ")}</span>
              )
            },
            {
              title: t("design.latestAssessment"),
              render: (_, candidate: DesignCandidate) =>
                candidate.latestAssessment ? (
                  <Space direction="vertical" size={2}>
                    <Tag color={assessmentStatusColor(candidate.latestAssessment.status)}>
                      {t(assessmentStatusLabelKeys[candidate.latestAssessment.status])}
                    </Tag>
                    <span translate="no">
                      {candidate.latestAssessment.predictedValue !== null
                        ? `${candidate.latestAssessment.predictedValue.toFixed(5)} ${candidate.latestAssessment.unit ?? ""}`.trim()
                        : "-"}
                    </span>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">{t("design.notAssessed")}</Typography.Text>
                )
            },
            {
              title: t("design.libraryStatus"),
              render: (_, candidate: DesignCandidate) =>
                candidate.inLibrary ? (
                  <Tag color="blue">{t("design.alreadyInLibrary")}</Tag>
                ) : (
                  <Tag>{t("design.notInWorkspace")}</Tag>
                )
            }
          ]}
        />
      </PagedModal>
    </div>
  );
}
