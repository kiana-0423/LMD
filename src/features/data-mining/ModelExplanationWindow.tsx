import { Alert, Button, Card, Select, Table, Tabs, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import EChart from "../../components/EChartCanvas";
import type { LmdChartOption } from "../../components/EChartCanvas";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { translateMessage } from "../../lib/backendMessages";
import { backendErrorText } from "../../lib/backendErrors";
import { explainMoleculeModel, type ExplanationRequest, type ModelExplanation } from "../../lib/modelExplanationApi";

export default function ModelExplanationWindow({ request }: { request: ExplanationRequest }) {
  const { t } = useLanguage();
  const [result, setResult] = useState<ModelExplanation>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("importance");
  const [sampleIndex, setSampleIndex] = useState(0);
  const pending = useRef<{ request: ExplanationRequest; revision: number; promise: Promise<ModelExplanation> }>();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    if (!pending.current || pending.current.request !== request || pending.current.revision !== revision) pending.current = { request, revision, promise: explainMoleculeModel(request) };
    pending.current.promise.then((value) => {
      if (!cancelled) { setResult(value); setSampleIndex(0); }
    }).catch((failure) => { if (!cancelled) setError(failure); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request, revision]);
  const data = result?.explanation;
  const caveat = request.example ? `${t("shap.exampleHelp")} ${t("shap.caveat")}` : t("shap.caveat");
  const sample = data?.samples[sampleIndex];
  const ranked = data?.importance ?? [];
  const top = ranked.slice(0, 12);
  const indexes = new Map(data?.feature_names.map((name, index) => [name, index]));
  const targetLabel = result?.targetLabelCode ? t(result.targetLabelCode as MessageKey) : result?.targetLabel || result?.target || "";
  const featureLabel = t("shap.variable");
  const valueLabel = `${t("shap.contribution")}${result?.unit ? ` (${result.unit})` : ""}`;
  const tooltip: LmdChartOption["tooltip"] = { trigger: "axis", renderMode: "richText", confine: true };
  let option: LmdChartOption = {
    grid: { left: 155, right: 24, top: 12, bottom: 45 }, tooltip,
    xAxis: { type: "value", name: t("shap.meanAbsolute"), nameLocation: "middle", nameGap: 28 },
    yAxis: { type: "category", inverse: true, data: top.map((item) => item.feature), axisLabel: { width: 135, overflow: "truncate" } },
    series: [{ type: "bar", data: top.map((item) => item.mean_abs_shap), itemStyle: { color: "#0f766e" } }]
  };
  if (tab === "distribution" && data) {
    const points = top.flatMap((item, rank) => {
      const index = indexes.get(item.feature)!;
      const observed = data.samples.map((row) => row.feature_values[index]).filter((value): value is number => value !== null);
      const low = Math.min(...observed), high = Math.max(...observed);
      return data.samples.map((row, rowIndex) => {
        const raw = row.feature_values[index];
        const fraction = raw === null || high === low ? 0.5 : (raw - low) / (high - low);
        return {
          value: [row.shap_values[index], rank + ((rowIndex * 0.61803398875) % 1 - 0.5) * 0.5],
          name: `${row.label}\n${item.feature}\n${featureLabel}: ${raw ?? t("shap.imputed")}\n${valueLabel}: ${row.shap_values[index]}`,
          // i18n-exempt: an RGB color specification, not interface text.
          itemStyle: { color: raw === null ? "#94a3b8" : `rgb(${Math.round(40 + 190 * fraction)},75,${Math.round(220 - 170 * fraction)})` }
        };
      });
    });
    option = {
      grid: { left: 155, right: 24, top: 12, bottom: 45 },
      tooltip: { trigger: "item", renderMode: "richText", confine: true, formatter: "{b}" },
      xAxis: { type: "value", name: valueLabel, nameLocation: "middle", nameGap: 28 },
      yAxis: { type: "value", inverse: true, min: -1, max: top.length, interval: 1,
        axisLabel: { width: 135, overflow: "truncate", formatter: (value: number) => top[value]?.feature ?? "" } },
      series: [{ type: "scatter", symbolSize: 7, data: points }]
    };
  }
  if (tab === "local" && data && sample) {
    const local = data.feature_names.map((feature, index) => ({ feature, value: sample.shap_values[index] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const visible = local.slice(0, 12);
    if (local.length > 12) visible.push({ feature: t("shap.otherVariables", { count: local.length - 12 }), value: local.slice(12).reduce((sum, item) => sum + item.value, 0) });
    option = {
      grid: { left: 155, right: 24, top: 12, bottom: 45 }, tooltip,
      xAxis: { type: "value", name: valueLabel, nameLocation: "middle", nameGap: 28 },
      yAxis: { type: "category", inverse: true, data: visible.map((item) => item.feature), axisLabel: { width: 135, overflow: "truncate" } },
      series: [{ type: "bar", data: visible.map((item) => ({ value: item.value, itemStyle: { color: item.value >= 0 ? "#e64b50" : "#367ec4" } })) }]
    };
  }
  return (
    <main className="shap-window">
      <header className="shap-window-header">
        <div><Typography.Title level={4}>{t(request.example ? "shap.exampleTitle" : "shap.title")}</Typography.Title>
          <Typography.Text ellipsis={{ tooltip: true }}>{result?.modelName ?? request.modelName ?? request.modelId}{result ? ` · ${targetLabel}${result.unit ? ` (${result.unit})` : ""}` : ""}</Typography.Text></div>
        <Button loading={loading} onClick={() => setRevision((value) => value + 1)}>{t("shap.recalculate")}</Button>
      </header>
      <Tooltip title={caveat} trigger={["hover", "focus"]}>
        <div tabIndex={0}><Alert className="shap-context" type={request.example ? "warning" : "info"} showIcon message={caveat} /></div>
      </Tooltip>
      {loading ? <Card loading className="shap-loading" /> : error ? (
        <Alert type="error" showIcon message={t("shap.failed")} description={backendErrorText(error, t)} />
      ) : data && sample ? <>
        <div className="shap-provenance">
          <Typography.Text>{t(data.cohort === "training_reference" ? "shap.trainingCohort" : "shap.selectedCohort", { count: data.sample_count, total: data.total_count })}</Typography.Text>
          {/* i18n-exempt: package name, version, algorithm and model timestamp are provenance. */}
          <Tooltip title={<span translate="no">{data.method} · SHAP {data.shap_version} · {result?.trainedAt}</span>}><span tabIndex={0}>{t(data.background_kind === "tree_path_counts" ? "shap.backgroundTrees" : "shap.background", { count: data.background_count, seed: data.seed })}</span></Tooltip>
          {result?.skipped.length ? <Tooltip title={result.skipped.map((item) => `${item.label}: ${translateMessage(item.reasonMessage, t) || item.reason || ""}`).join("\n")}><span tabIndex={0}>{t("shap.skipped", { count: result.skipped.length })}</span></Tooltip> : null}
        </div>
        <Tabs activeKey={tab} onChange={setTab} className="shap-view-tabs" items={[
          { key: "importance", label: t("shap.importance") }, { key: "distribution", label: t("shap.distribution") }, { key: "local", label: t("shap.local") }
        ]} />
        <div className="shap-panels">
          <Card className="shap-chart-card" size="small" title={t(tab === "local" ? "shap.local" : tab === "distribution" ? "shap.distribution" : "shap.importance")}>
            {tab === "local" ? <Select aria-label={t("shap.sample")} value={sampleIndex} onChange={setSampleIndex} options={data.samples.map((row, index) => ({ value: index, label: `${row.label || row.id} (${index + 1})` }))} /> : null}
            <div className="shap-chart"><EChart option={option} height="100%" ariaLabel={t("shap.title")} /></div>
            <Typography.Text className="shap-chart-caption" type="secondary">{tab === "local"
              ? t("shap.equation", { base: sample.base_value.toPrecision(6), sum: sample.shap_values.reduce((sum, value) => sum + value, 0).toPrecision(6), prediction: sample.prediction.toPrecision(6) })
              : t(tab === "distribution" ? "shap.colorLegend" : "shap.importanceHelp")}</Typography.Text>
            {request.example && tab === "local" && sample.reference_value !== undefined ? <Typography.Text className="shap-chart-caption" type="secondary">{t("shap.exampleReference", { value: sample.reference_value.toPrecision(6) })}</Typography.Text> : null}
          </Card>
          <Card className="shap-variable-card" size="small" title={t("shap.variables")}>
            <Table size="small" rowKey="feature" tableLayout="fixed" pagination={{ pageSize: 6, showSizeChanger: false, size: "small" }}
              dataSource={ranked.map((item) => ({ ...item, local: sample.shap_values[indexes.get(item.feature)!], raw: sample.feature_values[indexes.get(item.feature)!] }))}
              columns={[
                { title: featureLabel, dataIndex: "feature", ellipsis: true },
                { title: t("shap.meanAbsolute"), dataIndex: "mean_abs_shap", width: 105, render: (value: number) => value.toPrecision(4) },
                ...(tab === "local" ? [{ title: valueLabel, dataIndex: "local", width: 90, render: (value: number) => value.toPrecision(4) }] : [])
              ]} />
            <Typography.Text type="secondary">{t("shap.variablesHelp")}</Typography.Text>
          </Card>
        </div>
      </> : null}
    </main>
  );
}
