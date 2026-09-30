import { Alert, Radio, Statistic, Tag, Typography } from "antd";
import { useState } from "react";
import EChart, { type LmdChartOption } from "../../components/EChart";
import { useLanguage } from "../../i18n/LanguageContext";
import type { ModelMetrics } from "../../lib/api";

type View = "parity" | "residuals" | "histogram";
const compactNumber = (value: number) => Number(value.toPrecision(4)).toString();
const metricNumber = (value: number | undefined, digits: number) =>
  value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : "—";

/** Plots only the saved evaluation predictions, never predictions from the final refitted model. */
export default function ModelEvaluation({ metrics, unit = "" }: { metrics: ModelMetrics; unit?: string }) {
  const { t } = useLanguage();
  const [view, setView] = useState<View>("parity");
  const diagnostics = metrics.diagnostics;
  const heldOut = diagnostics ? diagnostics.cohort === "validation" : Boolean(metrics.validation);
  const scored = heldOut ? metrics.validation : metrics.training_only;
  const axisTitle = (label: string) => (unit ? `${label} (${unit})` : label);
  const views = [
    { value: "parity", label: t("model.evaluationParity") },
    { value: "residuals", label: t("model.evaluationResiduals") },
    { value: "histogram", label: t("model.evaluationHistogram") }
  ];
  let option: LmdChartOption | undefined;
  if (diagnostics?.points.length) {
    const points = diagnostics.points;
    const xName = axisTitle(
      t(
        view === "parity"
          ? "model.evaluationActual"
          : view === "residuals"
            ? "model.evaluationPredicted"
            : "model.evaluationError"
      )
    );
    const yName =
      view === "histogram"
        ? t("model.evaluationCount")
        : axisTitle(t(view === "parity" ? "model.evaluationPredicted" : "model.evaluationError"));
    const values = points.flatMap((point) => [point.actual, point.predicted]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min || Math.abs(max) || 1) * 0.08;
    const lower = min - padding;
    const upper = max + padding;
    const numericAxis = {
      type: "value" as const,
      scale: true,
      nameLocation: "middle" as const,
      axisLabel: { formatter: compactNumber },
      nameTextStyle: { fontSize: 12 }
    };
    option = {
      animation: false,
      grid: { left: 80, right: 25, top: 25, bottom: 68 },
      tooltip: { trigger: "item", renderMode: "richText", confine: true },
      xAxis:
        view === "histogram"
          ? {
              type: "category",
              name: xName,
              nameLocation: "middle",
              nameGap: 48,
              data: diagnostics.residual_histogram.map(
                (bin) => `${compactNumber(bin.start)} ~ ${compactNumber(bin.end)}`
              ),
              axisLabel: { rotate: 20, hideOverlap: true, fontSize: 10 }
            }
          : { ...numericAxis, name: xName, nameGap: 35, ...(view === "parity" ? { min: lower, max: upper } : {}) },
      yAxis: {
        ...numericAxis,
        name: yName,
        nameGap: 58,
        ...(view === "parity" ? { min: lower, max: upper } : view === "histogram" ? { min: 0, minInterval: 1 } : {})
      },
      series:
        view === "histogram"
          ? [
              {
                type: "bar",
                name: yName,
                data: diagnostics.residual_histogram.map((bin) => bin.count),
                itemStyle: { color: "#0d9488", borderRadius: [3, 3, 0, 0] },
                barMaxWidth: 40
              }
            ]
          : [
              {
                type: "scatter",
                name: views.find((item) => item.value === view)?.label,
                dimensions: [xName, yName],
                encode: { x: 0, y: 1, tooltip: [0, 1] },
                symbolSize: 8,
                itemStyle: { color: "#2563eb", opacity: 0.7 },
                data: points.map((point) => ({
                  name: point.label,
                  value: view === "parity" ? [point.actual, point.predicted] : [point.predicted, point.residual]
                })),
                ...(view === "residuals"
                  ? {
                      markLine: {
                        silent: true,
                        symbol: "none",
                        label: { show: false },
                        lineStyle: { color: "#64748b", type: "dashed" },
                        data: [{ yAxis: 0 }]
                      }
                    }
                  : {})
              },
              ...(view === "parity"
                ? [
                    {
                      type: "line" as const,
                      name: "y = x",
                      data: [
                        [lower, lower],
                        [upper, upper]
                      ],
                      symbol: "none",
                      silent: true,
                      lineStyle: { color: "#64748b", type: "dashed" as const, width: 1.5 }
                    }
                  ]
                : [])
            ]
    };
  }
  return (
    <div className="model-evaluation">
      {diagnostics && diagnostics.provenance.synthetic_count > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t("model.evaluationSynthetic", {
            count: diagnostics.provenance.synthetic_count,
            total: diagnostics.provenance.total_count
          })}
        />
      ) : null}
      <div className="model-training-metrics">
        <Statistic title={heldOut ? t("model.r2HeldOut") : t("model.r2InSample")} value={metricNumber(scored?.r2, 4)} />
        <Statistic title={t("model.meanAbsoluteError")} value={metricNumber(scored?.mae, 5)} suffix={unit} />
        <Statistic title={t("model.rootMeanSquaredError")} value={metricNumber(scored?.rmse, 5)} suffix={unit} />
        <Statistic
          title={t("model.scoredOn")}
          value={diagnostics?.sample_count ?? scored?.sampleCount ?? scored?.sample_count ?? "—"}
        />
      </div>
      <Typography.Text type="secondary" className="model-evaluation-help">
        {t("model.evaluationMetricsHelp")}
      </Typography.Text>
      {option ? (
        <>
          <div>
            <Tag color={heldOut ? "green" : "gold"}>{t(heldOut ? "model.heldOut" : "model.inSample")}</Tag>
            <Typography.Text type="secondary" className="model-evaluation-help">
              {t(heldOut ? "model.evaluationHeldOutHelp" : "model.evaluationInSampleHelp")}
            </Typography.Text>
          </div>
          <Radio.Group
            size="small"
            optionType="button"
            buttonStyle="solid"
            value={view}
            onChange={(event) => setView(event.target.value)}
            options={views}
            aria-label={t("model.evaluationTitle")}
          />
          <EChart option={option} height={280} ariaLabel={views.find((item) => item.value === view)?.label} />
          <Typography.Text type="secondary" className="model-evaluation-help">
            {t(view === "parity" ? "model.evaluationParityHelp" : "model.evaluationResidualHelp")}
          </Typography.Text>
          {diagnostics?.points_sampled ? (
            <Typography.Text type="secondary" className="model-evaluation-help">
              {t("model.evaluationSampled", {
                count: diagnostics.points.length,
                total: diagnostics.sample_count
              })}
            </Typography.Text>
          ) : null}
        </>
      ) : (
        <Alert type="info" showIcon message={t("model.evaluationMissing")} />
      )}
    </div>
  );
}
