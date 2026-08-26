import { Alert, Button, Card, Empty, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingBlock from "../../components/LoadingBlock";
import PageHeader from "../../components/PageHeader";
import {
  listModels,
  listMoleculePage,
  listPerformanceMetrics,
  predictMoleculePerformance,
  type SkippedPrediction,
  type TrainedModel
} from "../../lib/api";
import {
  CONCENTRATION_UNITS,
  basisLabelKey,
  buildConcentration,
  concentrationPolicy,
  type ConcentrationPolicy
} from "../../lib/concentrationPolicy";
import { describeBackendError } from "../../lib/backendErrors";
import { translateMessage } from "../../lib/backendMessages";
import { useLanguage } from "../../i18n/LanguageContext";
import type { Molecule } from "../../types";

const SCREENING_TARGETS = [
  "average_friction_coefficient",
  "wear_scar_diameter_value",
  "initial_oxidation_temperature_value",
  "extreme_pressure_value"
];

/** Lower is better for friction and wear; higher is better for oxidation and load capacity. */
function lowerIsBetter(target: string) {
  return target.includes("friction") || target.includes("wear_scar");
}

type Ranked = { id: string; label: string; value: number; rank: number };
/** One candidate the model could not rank, and why — as translated text plus its diagnostic. */
type Skipped = { label: string; reason: string; detail: string };

/** One ranking, and the concentration it is a ranking *at*. */
type RankingRun = {
  concentration?: number;
  unit?: string;
  ranked: Ranked[];
  skipped: Skipped[];
};

export default function MoleculeScreeningPage() {
  const { t } = useLanguage();
  const [target, setTarget] = useState(SCREENING_TARGETS[0]);
  const [metrics, setMetrics] = useState<Record<string, { labelCode?: string; label: string; unit: string }>>({});
  const [models, setModels] = useState<TrainedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [runs, setRuns] = useState<RankingRun[]>([]);
  const [resultSignature, setResultSignature] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [screening, setScreening] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [failure, setFailure] = useState<string>();

  // Deliberately empty, not 1: a screening concentration is a scientific choice, and a ranking
  // produced at a silently defaulted one would be presented as if it had been asked for.
  const [concentrations, setConcentrations] = useState<(number | null)[]>([null]);
  const [unit, setUnit] = useState<string>(CONCENTRATION_UNITS[0]);

  /**
   * Which request the visible state belongs to.
   *
   * Switching target starts a new load while the previous one is still in flight. Without this,
   * whichever finishes last wins — and the models for the target the user just left would be
   * listed under the target they just chose, with a ranking to match.
   */
  const requestVersion = useRef(0);
  const screeningVersion = useRef(0);

  useEffect(() => {
    listPerformanceMetrics()
      .then((items) =>
        setMetrics(
          Object.fromEntries(
            items.map((item) => [item.column, { labelCode: item.labelCode, label: item.label, unit: item.unit }])
          )
        )
      )
      .catch(() => setMetrics({}));
  }, []);

  const metricLabel = useCallback(
    (column: string) => {
      const metric = metrics[column];
      if (metric?.labelCode) return t(metric.labelCode as never);
      return metric?.label ?? column;
    },
    [metrics, t]
  );

  const refresh = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    screeningVersion.current += 1;
    setScreening(false);
    // Everything the previous target produced is cleared before the new request goes out, so
    // there is never a moment where a stale ranking sits under a freshly chosen metric.
    setLoading(true);
    setModels([]);
    setSelectedModelId(undefined);
    setRuns([]);
    setResultSignature(undefined);
    setFailure(undefined);
    setLoadError(undefined);
    try {
      // Screening ranks individual molecules, so only a molecule-level model can answer it. A
      // formulation-level model describes a whole blend and is deliberately not offered here.
      const [nextModels, page] = await Promise.all([
        listModels(target, "additive_component"),
        listMoleculePage({ page: 1, pageSize: 200 })
      ]);
      if (version !== requestVersion.current) return;
      const usableModels = nextModels.filter((item) => item.usable);
      setModels(usableModels);
      // The selection is visible and changeable below. Choosing the newest usable model keeps the
      // common one-model workflow quick without hiding which scientific model answers the request.
      setSelectedModelId(usableModels[0]?.id);
      setMolecules(page.items);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const model = models.find((item) => item.id === selectedModelId);
  const policy = concentrationPolicy(model?.concentrationBasis);
  const describedLoadError = loadError ? describeBackendError(loadError, t) : undefined;
  const describedFailure = failure ? describeBackendError(failure, t) : undefined;

  /** What the ranking on screen would have to match to still be current. */
  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        target,
        modelId: model?.id ?? "",
        moleculeCount: molecules.length,
        basis: policy?.basis ?? "",
        concentrations: policy?.needsValue ? concentrations : [],
        unit: policy?.needsUnit ? unit : ""
      }),
    [concentrations, model?.id, molecules.length, policy, target, unit]
  );

  const stale = runs.length > 0 && resultSignature !== undefined && resultSignature !== currentSignature;

  /**
   * The concentrations to rank at, validated against the model's basis.
   *
   * A model fitted without concentrations screens at exactly one "concentration": none at all.
   */
  function requestedConcentrations(current: ConcentrationPolicy): (number | null)[] | undefined {
    if (!current.needsValue) return [null];
    const supplied = concentrations.filter((value) => value !== null);
    if (supplied.length === 0) {
      message.warning(t("concentration.required"));
      return undefined;
    }
    for (const value of supplied) {
      const checked = buildConcentration(current, { value, unit });
      if (!checked.ok) {
        message.warning(t(checked.messageKey));
        return undefined;
      }
    }
    return supplied;
  }

  async function runScreening() {
    if (molecules.length === 0) {
      message.warning(t("screening.libraryEmpty"));
      return;
    }
    if (!model || !policy) return;
    // The model's own target must be the one on screen. A response that arrived from an earlier
    // request cannot reach here, but a model list that outlived its target could.
    if (model.target !== target || model.datasetMode !== "additive_component") {
      message.warning(t("model.selectionMismatch"));
      return;
    }
    const values = requestedConcentrations(policy);
    if (!values) return;

    setScreening(true);
    setFailure(undefined);
    const version = requestVersion.current;
    const operation = screeningVersion.current + 1;
    screeningVersion.current = operation;
    try {
      // One ranking per concentration: a ranking only means something at a single concentration,
      // so a sweep produces several rather than merging them into one misleading order.
      const produced: RankingRun[] = [];
      for (const value of values) {
        const checked = buildConcentration(policy, { value, unit });
        if (!checked.ok) {
          message.warning(t(checked.messageKey));
          return;
        }
        const result = await predictMoleculePerformance({
          modelId: model.id,
          items: molecules.map((item) => ({ moleculeId: item.id, ...checked.payload }))
        });
        const sorted = [...result.predictions].sort((a, b) =>
          lowerIsBetter(target) ? a.value - b.value : b.value - a.value
        );
        produced.push({
          concentration: checked.payload.concentration,
          unit: checked.payload.concentrationUnit,
          ranked: sorted.map((item, index) => ({ ...item, rank: index + 1 })),
          skipped: result.skipped.map((item) => describeSkipped(item))
        });
      }
      if (version !== requestVersion.current || operation !== screeningVersion.current) return;
      setRuns(produced);
      setResultSignature(currentSignature);
    } catch (caught) {
      if (version !== requestVersion.current || operation !== screeningVersion.current) return;
      setRuns([]);
      setResultSignature(undefined);
      setFailure(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (version === requestVersion.current && operation === screeningVersion.current) {
        setScreening(false);
      }
    }
  }

  function selectModel(modelId: string) {
    screeningVersion.current += 1;
    setScreening(false);
    setSelectedModelId(modelId);
    setFailure(undefined);
  }

  function selectTarget(nextTarget: string) {
    requestVersion.current += 1;
    screeningVersion.current += 1;
    setScreening(false);
    setTarget(nextTarget);
  }

  function describeSkipped(item: SkippedPrediction): Skipped {
    const translated = translateMessage(item.reasonMessage, t);
    return {
      label: item.label,
      reason: translated || item.reason || t("backend.skippedNoDescriptors", { subject: item.label }),
      // The English diagnostic is kept beside the sentence, never instead of it.
      detail: translated && item.reason && item.reason !== translated ? item.reason : ""
    };
  }

  const columns: ColumnsType<Ranked> = [
    { title: t("screening.rank"), dataIndex: "rank", width: 80 },
    {
      title: t("screening.molecule"),
      dataIndex: "label",
      render: (value) => <span translate="no">{value}</span>
    },
    {
      title: metricLabel(target),
      dataIndex: "value",
      width: 240,
      render: (value: number, row) => (
        <Space size={6}>
          <span>{`${value.toFixed(5)} ${metrics[target]?.unit ?? ""}`.trim()}</span>
          {row.rank <= 3 ? <Tag color="green">{t("screening.topCandidate")}</Tag> : null}
        </Space>
      )
    }
  ];

  function renderSkipped(skipped: Skipped[], ranked: number) {
    if (skipped.length === 0) return null;
    return (
      <Alert
        type={ranked === 0 ? "error" : "warning"}
        showIcon
        message={ranked === 0 ? t("screening.allSkippedTitle") : `${t("screening.partialTitle")} (${skipped.length})`}
        description={
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {skipped.slice(0, 8).map((item) => (
              <li key={`${item.label}-${item.reason}`}>
                <span translate="no">{item.label}</span> — {item.reason}
                {item.detail ? (
                  <div>
                    <Typography.Text type="secondary">
                      {t("ui.diagnosticDetail")}: <span translate="no">{item.detail}</span>
                    </Typography.Text>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        }
      />
    );
  }

  function renderConcentrationCard(current: ConcentrationPolicy) {
    if (!current.needsValue) {
      return (
        <Alert type="info" showIcon message={t("concentration.noneTitle")} description={t("concentration.noneHelp")} />
      );
    }
    return (
      <Card size="small" title={t(current.labelKey)}>
        <Typography.Paragraph type="secondary">{t(current.helpKey)}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">{t("screening.sweepHelp")}</Typography.Paragraph>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {concentrations.map((value, index) => (
            <Space key={index} size={8} wrap>
              <InputNumber
                min={0}
                step={0.1}
                value={value}
                placeholder={t(current.labelKey)}
                aria-label={`${t(current.labelKey)} ${index + 1}`}
                onChange={(next) =>
                  setConcentrations(concentrations.map((item, position) => (position === index ? next : item)))
                }
              />
              {index === 0 ? (
                current.needsUnit ? (
                  <Select
                    style={{ width: 170 }}
                    value={unit}
                    onChange={setUnit}
                    aria-label={t("model.concentrationUnit")}
                    options={CONCENTRATION_UNITS.map((item) => ({ value: item, label: item }))}
                  />
                ) : (
                  // No unit picker at all: this model was fitted on numbers with no unit, and
                  // offering one would invite a claim the data does not support.
                  <Typography.Text type="secondary">{t("concentration.unitNotSent")}</Typography.Text>
                )
              ) : (
                <Button onClick={() => setConcentrations(concentrations.filter((_, position) => position !== index))}>
                  {t("screening.sweepRemove")}
                </Button>
              )}
            </Space>
          ))}
          <Button onClick={() => setConcentrations([...concentrations, null])}>{t("screening.sweepAdd")}</Button>
        </Space>
      </Card>
    );
  }

  return (
    <div className="page-grid">
      <PageHeader title={t("screening.title")} description={t("screening.description")} />
      <Alert
        type="info"
        showIcon
        message={t("screening.rankingOnlyTitle")}
        description={t("screening.rankingOnlyBody")}
      />
      <Alert
        type="info"
        showIcon
        message={t("screening.additiveOnlyTitle")}
        description={t("screening.additiveOnlyBody")}
      />
      <Card>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={12} wrap>
            <Select
              style={{ width: 300 }}
              value={target}
              onChange={selectTarget}
              options={SCREENING_TARGETS.map((value) => ({ value, label: metricLabel(value) }))}
              aria-label={t("ui.performanceMetric")}
            />
            {loading ? (
              <Typography.Text type="secondary">{t("screening.modelsLoading")}</Typography.Text>
            ) : models.length > 0 ? (
              <Select
                style={{ minWidth: 320 }}
                value={selectedModelId}
                onChange={selectModel}
                aria-label={t("model.selectModel")}
                options={models.map((item) => ({
                  value: item.id,
                  label: <span translate="no">{item.name}</span>,
                  title: item.name
                }))}
              />
            ) : null}
          </Space>

          {model ? (
            <Typography.Text type="secondary">
              <span translate="no">{model.name}</span> — {t("model.algorithm")}: {model.algorithm} —{" "}
              {t("model.samples")}: {model.sampleCount} — {t("model.basis")}:{" "}
              {t(basisLabelKey(model.concentrationBasis))}
              {` — ${t("model.featureSchema")}: ${model.featureSchemaVersion}`}
            </Typography.Text>
          ) : null}

          {!loading && describedLoadError ? (
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
          ) : null}

          {!loading && model && policy ? renderConcentrationCard(policy) : null}

          <Button
            type="primary"
            loading={screening}
            // Disabled while the model list for this target is still loading: a ranking cannot
            // be requested before it is known which model would answer it.
            disabled={loading || !model || !policy}
            onClick={runScreening}
          >
            {`${t("screening.run")} — ${molecules.length} ${t("screening.moleculeCount")}`}
          </Button>
        </Space>
      </Card>

      <Card className="table-card">
        {loading ? (
          <LoadingBlock />
        ) : describedLoadError ? (
          <Alert type="error" showIcon message={t("ui.pageFailedToLoad")} />
        ) : models.length === 0 ? (
          <Alert type="info" showIcon message={t("screening.noModelTitle")} description={t("screening.noModelBody")} />
        ) : describedFailure ? (
          <Alert
            type="error"
            showIcon
            message={t("screening.failed")}
            description={
              <Space direction="vertical" size={4}>
                <span>{describedFailure.summary}</span>
                <span translate="no">{describedFailure.detail}</span>
              </Space>
            }
          />
        ) : stale ? (
          <Alert type="warning" showIcon message={t("screening.staleTitle")} description={t("screening.staleBody")} />
        ) : runs.length === 0 ? (
          <Empty description={t("screening.empty")} />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Typography.Text type="secondary">
              {lowerIsBetter(target) ? t("screening.lowerIsBetter") : t("screening.higherIsBetter")}
            </Typography.Text>
            {runs.map((run, index) => (
              <Space key={index} direction="vertical" size={8} style={{ width: "100%" }}>
                {run.concentration === undefined ? null : (
                  <Typography.Text strong>
                    {t("screening.atConcentration")}{" "}
                    {/* The value and its unit are the user's own input and stay together, so a
                        reader sees "1.5 ppm" rather than a number beside a stray word. */}
                    <span translate="no">{`${run.concentration} ${run.unit ?? ""}`.trim()}</span>
                    {run.unit ? null : ` (${t("concentration.unitNotSent")})`}
                  </Typography.Text>
                )}
                {renderSkipped(run.skipped, run.ranked.length)}
                {run.ranked.length > 0 ? (
                  <Table
                    size="small"
                    rowKey="id"
                    columns={columns}
                    dataSource={run.ranked}
                    pagination={{ pageSize: 10 }}
                  />
                ) : null}
              </Space>
            ))}
          </Space>
        )}
      </Card>
    </div>
  );
}
