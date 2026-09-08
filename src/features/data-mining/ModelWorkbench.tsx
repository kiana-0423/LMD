import { openModelExplanation, openModelExample } from "../../lib/modelExplanationApi";
import WorkspaceTabs from "../../components/WorkspaceTabs";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tooltip,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingBlock from "../../components/LoadingBlock";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import PageHeader from "../../components/PageHeader";
import {
  deliverExport,
  describeExport,
  describeTrainingScope,
  exportMlDataset,
  listBaseOils,
  listFormulations,
  listModels,
  listMoleculePage,
  listPerformanceMetrics,
  predictFormulationPerformance,
  predictMoleculePerformance,
  trainModel,
  type CandidateFormulation,
  type DatasetMode,
  type DatasetScope,
  type PredictionResult,
  type SkippedPrediction,
  type TrainedModel,
  type TrainingScopeOptions,
  type TrainingSummary
} from "../../lib/api";
import {
  DEFAULT_DATASET_SCOPE,
  LOAD_UNITS,
  TEMPERATURE_UNITS,
  modelUsesConditions,
  splitGroupingLabelKeys
} from "../../lib/designPolicy";
import {
  CONCENTRATION_UNITS,
  basisLabelKey,
  buildConcentration,
  concentrationPolicy,
  type ConcentrationPolicy
} from "../../lib/concentrationPolicy";
import type { BaseOil, Formulation, Molecule } from "../../types";
import { backendErrorText, describeBackendError } from "../../lib/backendErrors";
import { describeMessage, translateMessage, translateMessages } from "../../lib/backendMessages";

const ALGORITHM_KEYS: { value: string; key: MessageKey }[] = [
  { value: "auto", key: "model.algorithmAuto" },
  { value: "ridge", key: "model.algorithmRidge" },
  { value: "random_forest", key: "model.algorithmForest" },
  { value: "hist_gradient_boosting", key: "model.algorithmBoosting" }
];

function metricsOf(model: { metrics?: TrainedModel["metrics"] }) {
  const metrics = model.metrics ?? {};
  const scored = metrics.validation ?? metrics.training_only;
  return { scored, heldOut: Boolean(metrics.validation) };
}

/**
 * One row of a candidate blend the user is describing by hand.
 *
 * The concentration starts empty rather than at any number. Which fields are even shown depends
 * on the selected model's basis: a model fitted without concentrations gets a component id and
 * nothing else, because a value typed here would be a composition the user never measured.
 */
type CandidateRow = { key: number; id?: string; concentration: number | null; unit: string };

let nextCandidateKey = 1;

function newRow(): CandidateRow {
  nextCandidateKey += 1;
  return { key: nextCandidateKey, concentration: null, unit: CONCENTRATION_UNITS[0] };
}

export default function ModelWorkbench({
  titleKey,
  descriptionKey,
  targets,
  datasetMode
}: {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  targets: string[];
  /**
   * Locked per page. A page trains and predicts one kind of model, and the prediction controls
   * below are the ones that kind of model can actually answer — a molecule picker for a
   * molecule-level model, a formulation picker for a formulation-level one.
   */
  datasetMode: DatasetMode;
}) {
  const { t } = useLanguage();
  const aggregate = datasetMode === "formulation_aggregate";

  const [metricLabels, setMetricLabels] = useState<Record<string, { labelCode?: string; label: string; unit: string }>>(
    {}
  );
  const [target, setTarget] = useState(targets[0]);
  const [algorithm, setAlgorithm] = useState("auto");
  // Molecule training uses single-additive measurements; formulation training includes blends.
  const [scope, setScope] = useState<DatasetScope>({ ...DEFAULT_DATASET_SCOPE, singleAdditiveOnly: !aggregate });
  const [scopeOptions, setScopeOptions] = useState<TrainingScopeOptions>();
  // Test conditions for a prediction, needed only by a model fitted with condition features.
  const [temperatureValue, setTemperatureValue] = useState<number | null>(null);
  const [temperatureUnit, setTemperatureUnit] = useState<string>(TEMPERATURE_UNITS[0]);
  const [loadValue, setLoadValue] = useState<number | null>(null);
  const [loadUnit, setLoadUnit] = useState<string>(LOAD_UNITS[0]);
  const [models, setModels] = useState<TrainedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [baseOils, setBaseOils] = useState<BaseOil[]>([]);

  const [selectedMolecules, setSelectedMolecules] = useState<string[]>([]);
  // Empty, not 1. A concentration is a measurement, and one supplied on the user's behalf is a
  // claim they never made and cannot see they are making.
  const [concentration, setConcentration] = useState<number | null>(null);
  const [concentrationUnit, setConcentrationUnit] = useState<string>(CONCENTRATION_UNITS[0]);
  const [selectedFormulations, setSelectedFormulations] = useState<string[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [candidateAdditives, setCandidateAdditives] = useState<CandidateRow[]>([]);
  const [candidateBaseOils, setCandidateBaseOils] = useState<CandidateRow[]>([]);

  const [training, setTraining] = useState(false);
  const [explanationOpening, setExplanationOpening] = useState(false);
  const [exampleOpening, setExampleOpening] = useState(false);
  const [trainingWarningIndex, setTrainingWarningIndex] = useState(0);
  const [predicting, setPredicting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TrainingSummary>();
  const [prediction, setPrediction] = useState<PredictionResult>();
  // What the displayed prediction was produced from. When the current inputs no longer match it,
  // the numbers on screen describe something the user is no longer looking at — and rendering
  // them under a freshly chosen target's label would be simply wrong.
  const [predictionSignature, setPredictionSignature] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [trainingError, setTrainingError] = useState<string>();
  const [predictionError, setPredictionError] = useState<string>();

  /**
   * Which model-list request the visible state belongs to.
   *
   * `refresh` is re-created whenever the target changes, so switching target twice quickly leaves
   * two requests in flight. Without a version, whichever resolves last wins — and the models
   * trained for the target the user left would be listed, and selectable, under the target they
   * are now looking at.
   */
  const requestVersion = useRef(0);
  const trainingVersion = useRef(0);
  const predictionVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    // Reloading the model registry invalidates an operation addressed to its previous contents.
    predictionVersion.current += 1;
    setPredicting(false);
    setLoading(true);
    setLoadError(undefined);
    // The previous target's models go before the request is even made. A picker that keeps
    // showing them while the new list loads is offering a choice that is already wrong.
    setModels([]);
    setSelectedModelId(undefined);
    try {
      // Only models of this page's dataset mode: a formulation-level model must never appear in a
      // molecule-level picker, where it would answer a question it was not fitted for.
      const [nextModels, page, nextFormulations, nextBaseOils] = await Promise.all([
        listModels(target, datasetMode),
        listMoleculePage({ page: 1, pageSize: 200 }),
        aggregate ? listFormulations() : Promise.resolve([] as Formulation[]),
        aggregate ? listBaseOils() : Promise.resolve([] as BaseOil[])
      ]);
      // A response from an abandoned request is discarded rather than displayed.
      if (version !== requestVersion.current) return;
      setModels(nextModels);
      setMolecules(page.items);
      setFormulations(nextFormulations);
      setBaseOils(nextBaseOils);
      // Default to the newest usable model so the page is ready without a hidden fallback.
      setSelectedModelId(nextModels.find((model) => model.usable)?.id);
      return true;
    } catch (error) {
      if (version !== requestVersion.current) return false;
      setLoadError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [aggregate, datasetMode, target]);

  useEffect(() => {
    listPerformanceMetrics()
      .then((metrics) =>
        setMetricLabels(
          Object.fromEntries(
            metrics.map((item) => [item.column, { labelCode: item.labelCode, label: item.label, unit: item.unit }])
          )
        )
      )
      .catch(() => setMetricLabels({}));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (aggregate) return;
    let cancelled = false;
    describeTrainingScope(target)
      .then((options) => {
        if (!cancelled) setScopeOptions(options);
      })
      .catch(() => {
        if (!cancelled) setScopeOptions(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [aggregate, target]);

  // A training summary describes one target and carries no signature of its own, so switching
  // target has to clear it outright — otherwise figures measured for friction sit under a
  // wear-scar heading. A prediction is handled differently: its signature includes the target, so
  // it is marked out of date and named as such, which tells the user something was there.
  useEffect(() => {
    trainingVersion.current += 1;
    predictionVersion.current += 1;
    setTraining(false);
    setPredicting(false);
    setSummary(undefined);
    setTrainingError(undefined);
    setPredictionError(undefined);
  }, [target, datasetMode]);

  const metricLabel = useCallback(
    (column: string) => {
      const metric = metricLabels[column];
      if (metric?.labelCode) return t(metric.labelCode as MessageKey);
      return metric?.label ?? column;
    },
    [metricLabels, t]
  );

  const targetOptions = useMemo(
    () => targets.map((value) => ({ value, label: metricLabel(value) })),
    [metricLabel, targets]
  );

  const selectedModel = models.find((model) => model.id === selectedModelId);
  const policy = concentrationPolicy(selectedModel?.concentrationBasis);
  const needsConditions = !aggregate && modelUsesConditions(selectedModel);

  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        target,
        datasetMode,
        modelId: selectedModelId ?? "",
        basis: policy?.basis ?? "",
        molecules: aggregate ? [] : selectedMolecules,
        concentration: aggregate || !policy?.needsValue ? null : concentration,
        concentrationUnit: aggregate || !policy?.needsUnit ? "" : concentrationUnit,
        conditions: needsConditions ? [temperatureValue, temperatureUnit, loadValue, loadUnit] : [],
        formulations: aggregate ? selectedFormulations : [],
        candidateName: aggregate ? candidateName : "",
        candidateAdditives: aggregate ? candidateAdditives : [],
        candidateBaseOils: aggregate ? candidateBaseOils : []
      }),
    [
      aggregate,
      candidateAdditives,
      candidateBaseOils,
      candidateName,
      concentration,
      concentrationUnit,
      datasetMode,
      loadUnit,
      loadValue,
      needsConditions,
      policy,
      selectedFormulations,
      selectedModelId,
      selectedMolecules,
      target,
      temperatureUnit,
      temperatureValue
    ]
  );

  const predictionIsStale = Boolean(prediction) && predictionSignature !== currentSignature;
  const describedLoadError = loadError ? describeBackendError(loadError, t) : undefined;
  const describedTrainingError = trainingError ? describeBackendError(trainingError, t) : undefined;
  const describedPredictionError = predictionError ? describeBackendError(predictionError, t) : undefined;

  function selectTarget(nextTarget: string) {
    // Invalidate work synchronously with the user's choice. Waiting for the next effect would
    // leave a microtask-sized window in which an old result could land under the new target.
    requestVersion.current += 1;
    trainingVersion.current += 1;
    predictionVersion.current += 1;
    setTraining(false);
    setPredicting(false);
    setTarget(nextTarget);
  }

  async function handleExplain() {
    if (!selectedModel?.usable || aggregate || explanationOpening) return;
    let items: { moleculeId: string; concentration?: number; concentrationUnit?: string; temperatureValue?: number; temperatureUnit?: string; loadValue?: number; loadUnit?: string }[] = [];
    if (selectedMolecules.length) {
      if (!policy) return;
      const checked = buildConcentration(policy, { value: concentration, unit: concentrationUnit });
      if (!checked.ok) { message.warning(t(checked.messageKey)); return; }
      if (needsConditions && (temperatureValue === null || loadValue === null)) {
        message.warning(t("model.conditionsRequired")); return;
      }
      items = selectedMolecules.map((moleculeId) => ({ moleculeId, ...checked.payload,
        ...(needsConditions ? { temperatureValue: temperatureValue!, temperatureUnit, loadValue: loadValue!, loadUnit } : {})
      }));
    }
    setExplanationOpening(true);
    try { await openModelExplanation({ modelId: selectedModel.id, items }); }
    catch (error) { message.error(backendErrorText(error, t)); }
    finally { setExplanationOpening(false); }
  }

  async function handleExample() {
    if (exampleOpening) return;
    setExampleOpening(true);
    try { await openModelExample(); }
    catch (error) { message.error(backendErrorText(error, t)); }
    finally { setExampleOpening(false); }
  }

  async function handleTrain() {
    const operation = trainingVersion.current + 1;
    trainingVersion.current = operation;
    setTraining(true);
    setTrainingError(undefined);
    try {
      const result = await trainModel({ target, algorithm, datasetMode, scope: aggregate ? undefined : scope });
      if (operation !== trainingVersion.current) return;
      setSummary(result);
      setTrainingWarningIndex(0);
      message.success(`${t("model.train")}: ${result.sampleCount}`);
      const refreshed = await refresh();
      if (operation !== trainingVersion.current) return;
      if (refreshed) setSelectedModelId(result.modelId);
    } catch (error) {
      if (operation !== trainingVersion.current) return;
      setSummary(undefined);
      setTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation === trainingVersion.current) setTraining(false);
    }
  }

  /**
   * Turns the candidate rows into the payload shape, or reports what is still missing.
   *
   * Which fields count as missing depends on the model: a `none`-basis candidate needs component
   * ids and nothing more, and demanding a concentration for it would be asking the user to invent
   * one. Returns `undefined` when there is no candidate to send at all, which is not an error.
   */
  function buildCandidate(current: ConcentrationPolicy): CandidateFormulation | undefined | null {
    if (candidateAdditives.length === 0) return undefined;
    const rows = [...candidateAdditives, ...candidateBaseOils];
    if (rows.some((row) => !row.id)) {
      message.warning(t("model.candidateIncomplete"));
      return null;
    }
    const additives: CandidateFormulation["additives"] = [];
    for (const row of candidateAdditives) {
      const checked = buildConcentration(current, { value: row.concentration, unit: row.unit });
      if (!checked.ok) {
        message.warning(t(checked.messageKey));
        return null;
      }
      additives.push({ moleculeId: row.id as string, ...checked.payload });
    }
    const oils: NonNullable<CandidateFormulation["baseOils"]> = [];
    for (const row of candidateBaseOils) {
      const checked = buildConcentration(current, { value: row.concentration, unit: row.unit });
      if (!checked.ok) {
        message.warning(t(checked.messageKey));
        return null;
      }
      oils.push({ baseOilId: row.id as string, ...checked.payload });
    }
    return { name: candidateName.trim() || undefined, additives, baseOils: oils };
  }

  async function handlePredict() {
    if (!selectedModel || !policy) {
      message.warning(t("model.selectModelFirst"));
      return;
    }
    // Checked immediately before the request, against the model as it is now: a list that
    // arrived for an earlier target, or a mode that changed since selection, must not predict.
    if (selectedModel.target !== target || selectedModel.datasetMode !== datasetMode) {
      message.warning(t("model.selectionMismatch"));
      return;
    }
    const version = requestVersion.current;
    const operation = predictionVersion.current + 1;
    predictionVersion.current = operation;

    let request: Promise<PredictionResult>;
    if (aggregate) {
      const candidate = buildCandidate(policy);
      if (candidate === null) return;
      request = predictFormulationPerformance({
        modelId: selectedModel.id,
        formulationIds: selectedFormulations,
        candidates: candidate ? [candidate] : []
      });
    } else {
      const checked = buildConcentration(policy, {
        value: concentration,
        unit: concentrationUnit
      });
      if (!checked.ok) {
        message.warning(t(checked.messageKey));
        return;
      }
      // A model fitted with condition features is only asked with both conditions supplied;
      // any other model is sent none, so nothing it would ignore is ever entered.
      let conditions: { temperatureValue: number; temperatureUnit: string; loadValue: number; loadUnit: string } | undefined;
      if (needsConditions) {
        if (temperatureValue === null || loadValue === null) {
          message.warning(t("model.conditionsRequired"));
          return;
        }
        conditions = { temperatureValue, temperatureUnit, loadValue, loadUnit };
      }
      request = predictMoleculePerformance({
        modelId: selectedModel.id,
        items: selectedMolecules.map((moleculeId) => ({ moleculeId, ...checked.payload, ...(conditions ?? {}) }))
      });
    }

    setPredicting(true);
    setPredictionError(undefined);
    try {
      const result = await request;
      if (version !== requestVersion.current || operation !== predictionVersion.current) return;
      setPrediction(result);
      setPredictionSignature(currentSignature);
    } catch (error) {
      if (version !== requestVersion.current || operation !== predictionVersion.current) return;
      setPrediction(undefined);
      setPredictionSignature(undefined);
      setPredictionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === requestVersion.current && operation === predictionVersion.current) {
        setPredicting(false);
      }
    }
  }

  async function handleExportDataset() {
    try {
      const result = await exportMlDataset(target, "", datasetMode, aggregate ? undefined : scope);
      deliverExport(result);
      message.success(
        describeExport(result, t("model.exportDataset"), {
          savedTo: t("ui.exportedRowsTo"),
          exported: t("ui.exportedShort")
        })
      );
    } catch (error) {
      message.error(backendErrorText(error, t));
    }
  }

  const modelColumns: ColumnsType<TrainedModel> = [
    { title: t("model.trained"), dataIndex: "trainedAt", width: 200 },
    { title: t("model.algorithm"), dataIndex: "algorithm", width: 170 },
    { title: t("model.samples"), dataIndex: "sampleCount", width: 90 },
    { title: t("model.features"), dataIndex: "featureCount", width: 90 },
    {
      title: t("model.basis"),
      dataIndex: "concentrationBasis",
      width: 160,
      render: (basis: string) => t(basisLabelKey(basis))
    },
    {
      title: t("model.score"),
      render: (_, row) => {
        const { scored, heldOut } = metricsOf(row);
        return (
          <Space size={6} wrap>
            {row.usable ? null : <Tag color="red">{t("model.outdatedSchema")}</Tag>}
            {scored ? (
              <>
                <Tag color={heldOut ? "green" : "gold"}>{heldOut ? t("model.heldOut") : t("model.inSample")}</Tag>
                <span>R² {scored.r2.toFixed(3)}</span>
                <span>MAE {scored.mae.toFixed(4)}</span>
              </>
            ) : (
              <span>-</span>
            )}
          </Space>
        );
      }
    }
  ];

  const predictionColumns: ColumnsType<{ id: string; label: string; value: number }> = [
    {
      title: aggregate ? t("model.predictionTarget") : t("model.molecule"),
      dataIndex: "label",
      render: (value) => <span translate="no">{value}</span>
    },
    {
      title: metricLabel(target),
      dataIndex: "value",
      width: 220,
      render: (value: number) => `${value.toFixed(5)} ${metricLabels[target]?.unit ?? ""}`.trim()
    }
  ];

  /** One skipped record, as a translated sentence plus the English diagnostic behind it. */
  function renderSkipped(item: SkippedPrediction) {
    const explained = describeMessage(item.reasonMessage, t);
    const text = explained.text || item.reason || "";
    return (
      <li key={item.id}>
        <span translate="no">{item.label}</span>
        {text ? ` — ${text}` : null}
        {item.missingCount ? ` (${item.missingCount} ${t("model.skippedDetail")})` : null}
        {explained.detail && explained.detail !== text ? (
          <div>
            <Typography.Text type="secondary">
              {t("ui.diagnosticDetail")}: <span translate="no">{explained.detail}</span>
            </Typography.Text>
          </div>
        ) : null}
      </li>
    );
  }

  function renderCandidateRows(
    rows: CandidateRow[],
    setRows: (rows: CandidateRow[]) => void,
    options: { value: string; label: string }[],
    current: ConcentrationPolicy
  ) {
    return rows.map((row, index) => (
      <Space key={row.key} size={8} wrap style={{ display: "flex", marginBottom: 8 }}>
        <Select
          style={{ width: 260, maxWidth: "100%" }}
          value={row.id}
          showSearch
          optionFilterProp="label"
          options={options}
          aria-label={t("model.candidateComponent")}
          onChange={(value) =>
            setRows(rows.map((item, position) => (position === index ? { ...item, id: value } : item)))
          }
        />
        {/* A `none`-basis model gets component ids and nothing else: there is no concentration to
            supply, so there is no field that could invent one. */}
        {current.needsValue ? (
          <InputNumber
            min={0}
            step={0.1}
            value={row.concentration}
            placeholder={t(current.labelKey)}
            aria-label={`${t(current.labelKey)} ${index + 1}`}
            onChange={(value) =>
              setRows(rows.map((item, position) => (position === index ? { ...item, concentration: value } : item)))
            }
          />
        ) : null}
        {current.needsUnit ? (
          <Select
            style={{ width: 150 }}
            value={row.unit}
            aria-label={t("model.concentrationUnit")}
            options={CONCENTRATION_UNITS.map((unit) => ({ value: unit, label: unit }))}
            onChange={(value) =>
              setRows(rows.map((item, position) => (position === index ? { ...item, unit: value } : item)))
            }
          />
        ) : null}
        {current.needsValue && !current.needsUnit ? (
          <Typography.Text type="secondary">{t("concentration.unitNotSent")}</Typography.Text>
        ) : null}
        <Button danger onClick={() => setRows(rows.filter((_, position) => position !== index))}>
          {t("model.candidateRemove")}
        </Button>
      </Space>
    ));
  }

  const trainingScores = summary ? metricsOf(summary) : undefined;
  const trainingNotices = summary ? [
    ...translateMessages(summary.warnings, t).map((warning) => ({ title: warning, body: warning })),
    ...(summary.excludedForUnits > 0 ? [{
      title: `${t("model.unitExclusionsTitle")}: ${summary.excludedForUnits}`,
      body: translateMessages(summary.datasetReport?.warnings, t).join("\n")
    }] : []),
    ...(trainingScores?.scored && !trainingScores.heldOut ? [{ title: t("model.inSampleWarningTitle"), body: t("model.inSampleWarningBody") }] : []),
    ...(summary.sampleCount < 30 ? [{ title: `${t("model.smallSampleTitle")} (${summary.sampleCount})`, body: t("model.smallSampleBody") }] : [])
  ] : [];

  return (
    <div className="page-grid workspace-page model-workbench-page">
      <PageHeader
        title={t(titleKey)}
        description={t(descriptionKey)}
        extra={
          <Space wrap>
          {!aggregate && <Tooltip title={t("shap.exampleHelp")}><Button loading={exampleOpening} onClick={() => void handleExample()}>{t("shap.exampleOpen")}</Button></Tooltip>}
          <Select
            style={{ width: 280 }}
            value={target}
            options={targetOptions}
            onChange={selectTarget}
            aria-label={t("ui.performanceMetric")}
          />
          </Space>
        }
      />
      <WorkspaceTabs unpagedKeys={["0"]} labels={[t("model.trainTitle"), t("model.modelsTitle"), t("model.predictTitle")]}>
        <div className="model-training-workspace">
          <div className="model-training-context">
            <Tooltip title={t("model.workspaceOnlyBody")} trigger={["hover", "focus"]}>
              <span tabIndex={0}>{t("model.workspaceOnlyTitle")}</span>
            </Tooltip>
            <Tooltip title={aggregate ? t("model.datasetInterpretationFormulation") : t("model.datasetInterpretationAdditive")} trigger={["hover", "focus"]}>
              <span tabIndex={0}>{aggregate ? t("model.modeLockedFormulation") : t("model.modeLockedAdditive")}</span>
            </Tooltip>
          </div>
          <div className="model-training-columns">
            <Card size="small" title={t("model.trainingSettings")} className="model-training-settings">
              <div className="model-training-algorithm">
                <Typography.Text>{t("model.algorithm")}</Typography.Text>
                <Select
                  value={algorithm}
                  options={ALGORITHM_KEYS.map((item) => ({ value: item.value, label: t(item.key) }))}
                  onChange={setAlgorithm}
                  aria-label={t("model.algorithm")}
                />
              </div>
            {!aggregate ? (
              <Card size="small" title={t("model.scopeTitle")} className="model-training-scope">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Tooltip title={<>{t("model.scopeSingleAdditiveOnly")} — {t("model.scopeSingleAdditiveHelp", {
                    single: scopeOptions?.singleAdditiveResultCount ?? 0,
                    multi: scopeOptions?.multiAdditiveResultCount ?? 0
                  })}</>} trigger={["hover", "focus"]}>
                    <Tag color="blue">
                      {t("model.scopeSingleAdditiveOnly")}
                    </Tag>
                  </Tooltip>
                  <div className="model-training-test-type">
                    <span>{t("model.scopeTestType")}</span>
                    <Select
                      style={{ width: "100%" }}
                      value={scope.testType || ""}
                      aria-label={t("model.scopeTestType")}
                      onChange={(value) => setScope({ ...scope, testType: value })}
                      options={[
                        { value: "", label: t("model.scopeAllTestTypes") },
                        ...(scopeOptions?.testTypes ?? [])
                          .filter((item) => item.value)
                          .map((item) => ({
                            value: item.value,
                            label: <span translate="no">{`${item.value} (${item.resultCount})`}</span>
                          }))
                      ]}
                    />
                  </div>
                  <Tooltip title={<>{t("model.scopeConditionFeatures")} — {t("model.scopeConditionFeaturesHelp", { available: scopeOptions?.resultsWithConditions ?? 0 })}</>} trigger={["hover", "focus"]}>
                    <Checkbox checked={scope.includeConditionFeatures} onChange={(event) => setScope({ ...scope, includeConditionFeatures: event.target.checked })}>
                      {t("model.scopeConditionFeatures")}
                    </Checkbox>
                  </Tooltip>
                </Space>
              </Card>
            ) : null}
              <div className="model-training-actions">
                <Button type="primary" loading={training} onClick={handleTrain}>{t("model.train")}</Button>
                <Button onClick={handleExportDataset}>{t("model.exportDataset")}</Button>
              </div>
            </Card>
            <Card size="small" title={t("model.trainingResults")} className="model-training-results">
              {describedTrainingError ? (
                <Tooltip title={<><div>{describedTrainingError.summary}</div><div translate="no">{describedTrainingError.detail}</div></>} trigger={["hover", "focus"]}>
                  <div tabIndex={0} className="model-training-error">
                    <Alert type="error" showIcon message={t("model.trainFailed")}
                      description={<><div>{describedTrainingError.summary}</div><div translate="no">{describedTrainingError.detail}</div></>} />
                  </div>
                </Tooltip>
              ) : summary ? (
                <Tabs key={summary.modelId} className="model-training-result-tabs" size="small" items={[
                  {
                    key: "overview", label: t("model.trainingOverview"), children: (
                      <div className="model-training-overview">
                        <div className="model-training-counts">
                          <span>{t("model.samples")}: <strong>{summary.sampleCount}</strong></span>
                          <span>{t("model.independentMolecules")}: <strong>{summary.moleculeCount ?? 0}</strong></span>
                        </div>
                        {trainingScores?.scored ? (
                          <div className="model-training-metrics">
                            <Statistic title={trainingScores.heldOut ? t("model.r2HeldOut") : t("model.r2InSample")} value={trainingScores.scored.r2.toFixed(4)} />
                            <Statistic title={t("model.meanAbsoluteError")} value={trainingScores.scored.mae.toFixed(5)} />
                            <Statistic title={t("model.rootMeanSquaredError")} value={trainingScores.scored.rmse.toFixed(5)} />
                            <Statistic title={t("model.scoredOn")} value={trainingScores.scored.sampleCount ?? trainingScores.scored.sample_count ?? 0} />
                          </div>
                        ) : <Alert type="info" showIcon message={t("model.trainingNoMetrics")} />}
                        <Typography.Paragraph type="secondary" ellipsis={{ rows: 1, tooltip: true }}>
                          {t("model.splitPrefix")} {translateMessage(summary.splitMethodMessage, t) || summary.splitMethod}
                          {summary.groupCount > 0 ? ` — ${summary.groupCount} ${t("model.groupSuffix")}` : ""}
                          {summary.multiAdditiveResultCount > 0 ? ` — ${summary.multiAdditiveResultCount} ${t("model.multiAdditiveNote")}` : ""}
                        </Typography.Paragraph>
                        <Typography.Paragraph type="secondary" ellipsis={{ rows: 1, tooltip: true }}>
                          {summary.interpretationCode ? translateMessage({ code: summary.interpretationCode }, t) : summary.interpretation}
                        </Typography.Paragraph>
                        {trainingScores?.scored && !trainingScores.heldOut ? (
                          <Tooltip title={t("model.inSampleWarningBody")} trigger={["hover", "focus"]}>
                            <div tabIndex={0}><Alert className="model-training-compact-alert" type="warning" showIcon message={t("model.inSampleWarningTitle")} /></div>
                          </Tooltip>
                        ) : null}
                        {summary.sampleCount < 30 ? (
                          <Tooltip title={t("model.smallSampleBody")} trigger={["hover", "focus"]}>
                            <div tabIndex={0}><Alert className="model-training-compact-alert" type="warning" showIcon message={`${t("model.smallSampleTitle")} (${summary.sampleCount})`} /></div>
                          </Tooltip>
                        ) : null}
                      </div>
                    )
                  },
                  {
                    key: "details", label: t("model.trainingDetails"), children: (
                      <dl className="model-training-facts">
                        {[
                          [t("model.algorithm"), summary.algorithm],
                          [t("model.modelVersion"), summary.modelVersion],
                          [t("model.trainedAt"), summary.trainedAt],
                          [t("model.samples"), summary.sampleCount],
                          [t("model.features"), summary.featureCount],
                          [t("model.excluded"), summary.excludedCount ?? 0],
                          [t("model.independentMolecules"), summary.moleculeCount ?? 0],
                          [t("model.splitGrouping"), summary.splitGrouping ? t(splitGroupingLabelKeys[summary.splitGrouping] ?? "design.groupingNone") : "-"],
                          [t("model.basis"), t(basisLabelKey(summary.concentrationBasis))],
                          [t("model.datasetInterpretation"), summary.interpretationCode ? translateMessage({ code: summary.interpretationCode }, t) : summary.interpretation]
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt title={String(label)}>{label}</dt>
                            <dd><Tooltip title={String(value)} trigger={["hover", "focus"]}><span tabIndex={0}>{value}</span></Tooltip></dd>
                          </div>
                        ))}
                      </dl>
                    )
                  },
                  {
                    key: "warnings", label: `${t("model.trainingNotices")} (${trainingNotices.length})`, children: trainingNotices.length ? (
                      <div className="model-training-notices">
                        <Select
                          aria-label={t("model.trainingNotices")}
                          value={Math.min(trainingWarningIndex, trainingNotices.length - 1)}
                          onChange={setTrainingWarningIndex}
                          options={trainingNotices.map((notice, index) => ({ value: index, label: `${index + 1}. ${notice.title}` }))}
                        />
                        <Tooltip title={trainingNotices[Math.min(trainingWarningIndex, trainingNotices.length - 1)].body} trigger={["hover", "focus"]}>
                          <div tabIndex={0}><Alert type="warning" showIcon message={trainingNotices[Math.min(trainingWarningIndex, trainingNotices.length - 1)].title}
                            description={trainingNotices[Math.min(trainingWarningIndex, trainingNotices.length - 1)].body} /></div>
                        </Tooltip>
                      </div>
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("model.trainingNoNotices")} />
                  }
                ]} />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={training ? t("model.trainingInProgress") : t("model.trainingAwaitingResult")} />}
            </Card>
          </div>
        </div>
        <Card title={t("model.modelsTitle")}>
          {loading ? (
            <LoadingBlock />
          ) : describedLoadError ? (
            <Alert
              type="error"
              showIcon
              message={t("ui.pageFailedToLoad")}
              description={
                <Space direction="vertical" size={4}>
                  <span>{describedLoadError.summary}</span>
                  <span translate="no">{describedLoadError.detail}</span>
                </Space>
              }
              action={<Button onClick={() => void refresh()}>{t("ui.retry")}</Button>}
            />
          ) : models.length === 0 ? (
            <Empty description={t("model.noModels")} />
          ) : (
            <Table
              scroll={{ x: "max-content" }}
              size="small"
              rowKey="id"
              columns={modelColumns}
              dataSource={models}
              pagination={false}
              // The prediction below names the model it came from, so the model is chosen here
              // rather than assumed to be the most recent one.
              rowSelection={{
                type: "radio",
                selectedRowKeys: selectedModelId ? [selectedModelId] : [],
                onChange: (keys) => setSelectedModelId(keys[0] as string),
                getCheckboxProps: (row) => ({ disabled: !row.usable })
              }}
            />
          )}
        </Card>
        <Card title={t("model.predictTitle")} extra={!aggregate ? (
          <Tooltip title={t("shap.openHelp")}><Button disabled={!selectedModel?.usable || loading} loading={explanationOpening} onClick={() => void handleExplain()}>{t("shap.open")}</Button></Tooltip>
        ) : undefined}>
          {loading ? (
            <Alert type="info" showIcon message={t("model.modelsLoading")} />
          ) : describedLoadError ? (
            <Alert type="error" showIcon message={t("ui.pageFailedToLoad")} />
          ) : !selectedModel ? (
            <Alert
              type="info"
              showIcon
              message={models.length === 0 ? t("model.noModelTitle") : t("model.selectModel")}
              description={models.length === 0 ? t("model.noModelBody") : t("model.selectModelFirst")}
            />
          ) : (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                {t("model.selected")}: <span translate="no">{selectedModel.name}</span> — {t("model.basis")}:{" "}
                {t(basisLabelKey(selectedModel.concentrationBasis))}
              </Typography.Text>
              {selectedModel.usable ? null : (
                <Alert
                  type="error"
                  showIcon
                  message={t("model.outdatedSchema")}
                  description={t("model.outdatedSchemaBody")}
                />
              )}
              {policy ? (
                <Alert
                  type="info"
                  showIcon
                  message={policy.needsValue ? t(policy.labelKey) : t("concentration.noneTitle")}
                  description={t(policy.helpKey)}
                />
              ) : (
                <Alert
                  type="error"
                  showIcon
                  message={t("model.outdatedSchema")}
                  description={t("backend.datasetUnknownBasis")}
                />
              )}

              {aggregate && policy ? (
                <>
                  <Space size={12} wrap>
                    <Select
                      mode="multiple"
                      style={{ width: 420, maxWidth: "100%" }}
                      placeholder={t("model.selectFormulations")}
                      aria-label={t("model.selectFormulations")}
                      value={selectedFormulations}
                      onChange={setSelectedFormulations}
                      optionFilterProp="title"
                      notFoundContent={t("model.noFormulations")}
                      options={formulations.map((item) => ({
                        value: item.id,
                        title: item.name,
                        label: <span translate="no">{item.name}</span>
                      }))}
                    />
                  </Space>
                  <Card size="small" title={t("model.candidateTitle")}>
                    <Typography.Paragraph type="secondary">{t("model.candidateExplanation")}</Typography.Paragraph>
                    <Input
                      style={{ maxWidth: 360, marginBottom: 12 }}
                      placeholder={t("model.candidateName")}
                      aria-label={t("model.candidateName")}
                      value={candidateName}
                      onChange={(event) => setCandidateName(event.target.value)}
                    />
                    <Typography.Text strong>{t("formulation.additives")}</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      {renderCandidateRows(
                        candidateAdditives,
                        setCandidateAdditives,
                        molecules.map((item) => ({ value: item.id, label: item.name })),
                        policy
                      )}
                    </div>
                    <Button onClick={() => setCandidateAdditives([...candidateAdditives, newRow()])}>
                      {t("model.candidateAddAdditive")}
                    </Button>
                    <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
                      {t("formulation.baseOil")}
                    </Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      {renderCandidateRows(
                        candidateBaseOils,
                        setCandidateBaseOils,
                        baseOils.map((item) => ({ value: item.id, label: item.name })),
                        policy
                      )}
                    </div>
                    <Button onClick={() => setCandidateBaseOils([...candidateBaseOils, newRow()])}>
                      {t("model.candidateAddBaseOil")}
                    </Button>
                  </Card>
                </>
              ) : null}

              {!aggregate && policy ? (
                <Space size={12} wrap>
                  <Select
                    mode="multiple"
                    style={{ width: 360, maxWidth: "100%" }}
                    placeholder={t("model.selectMoleculesToPredict")}
                    aria-label={t("model.selectMoleculesToPredict")}
                    value={selectedMolecules}
                    onChange={setSelectedMolecules}
                    optionFilterProp="title"
                    notFoundContent={t("model.noMolecules")}
                    options={molecules.map((molecule) => ({
                      value: molecule.id,
                      title: molecule.name,
                      label: <span translate="no">{molecule.name}</span>
                    }))}
                  />
                  {policy.needsValue ? (
                    <InputNumber
                      min={0}
                      step={0.1}
                      value={concentration}
                      onChange={setConcentration}
                      placeholder={t(policy.labelKey)}
                      addonBefore={t(policy.labelKey)}
                      aria-label={t(policy.labelKey)}
                    />
                  ) : null}
                  {policy.needsUnit ? (
                    <Select
                      style={{ width: 170 }}
                      value={concentrationUnit}
                      onChange={setConcentrationUnit}
                      aria-label={t("model.concentrationUnit")}
                      options={CONCENTRATION_UNITS.map((unit) => ({ value: unit, label: unit }))}
                    />
                  ) : null}
                  {policy.needsValue && !policy.needsUnit ? (
                    <Typography.Text type="secondary">{t("concentration.unitNotSent")}</Typography.Text>
                  ) : null}
                </Space>
              ) : null}
              {/* Shown only for a model that actually uses them: a temperature typed for a model
                    fitted without condition features would be a control the model ignores. */}
              {needsConditions ? (
                <Card size="small" title={t("model.conditionInputsTitle")}>
                  <Space direction="vertical" size={8}>
                    <Typography.Text type="secondary">{t("model.conditionInputsHelp")}</Typography.Text>
                    <Space size={8} wrap>
                      <InputNumber
                        value={temperatureValue}
                        onChange={setTemperatureValue}
                        addonBefore={t("design.conditionTemperature")}
                        aria-label={t("design.conditionTemperature")}
                      />
                      <Select
                        style={{ width: 90 }}
                        value={temperatureUnit}
                        onChange={setTemperatureUnit}
                        aria-label={t("design.temperatureUnit")}
                        options={TEMPERATURE_UNITS.map((unit) => ({ value: unit, label: unit }))}
                      />
                      <InputNumber
                        min={0}
                        value={loadValue}
                        onChange={setLoadValue}
                        addonBefore={t("design.conditionLoad")}
                        aria-label={t("design.conditionLoad")}
                      />
                      <Select
                        style={{ width: 90 }}
                        value={loadUnit}
                        onChange={setLoadUnit}
                        aria-label={t("design.loadUnit")}
                        options={LOAD_UNITS.map((unit) => ({ value: unit, label: unit }))}
                      />
                    </Space>
                  </Space>
                </Card>
              ) : null}

              <Space>
                <Button
                  type="primary"
                  loading={predicting}
                  // Disabled while a model list is loading, and for a model this build cannot use.
                  disabled={loading || !selectedModel.usable || !policy}
                  onClick={handlePredict}
                >
                  {t("model.predict")}
                </Button>
              </Space>
            </Space>
          )}

          {describedPredictionError ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message={t("model.predictFailed")}
              description={
                <Space direction="vertical" size={4}>
                  <span>{describedPredictionError.summary}</span>
                  <span translate="no">{describedPredictionError.detail}</span>
                </Space>
              }
            />
          ) : null}
          {predictionIsStale ? (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message={t("model.staleTitle")}
              description={t("model.staleBody")}
            />
          ) : null}
          {prediction && !predictionIsStale ? (
            <Space direction="vertical" style={{ width: "100%", marginTop: 12 }} size={12}>
              <Typography.Text type="secondary">
                {t("model.predictedWith")} <span translate="no">{prediction.modelName}</span> (
                <span translate="no">{prediction.algorithm}</span>) — {prediction.trainedAt} — {prediction.sampleCount}
              </Typography.Text>
              {prediction.skipped.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`${prediction.skipped.length} ${t("model.skipped")}`}
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                      {prediction.skipped.map((item) => renderSkipped(item))}
                    </ul>
                  }
                />
              ) : null}
              <Table
                scroll={{ x: "max-content" }}
                size="small"
                rowKey="id"
                columns={predictionColumns}
                dataSource={prediction.predictions}
                pagination={false}
              />
            </Space>
          ) : null}
        </Card>
      </WorkspaceTabs>
    </div>
  );
}
