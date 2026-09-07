import { Alert, Form, Input, InputNumber, Select, Tabs } from "antd";
import type { ReactNode } from "react";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { performanceFields, TEST_TYPES } from "../../lib/experimentProtocol";

const RESULTS: { name: string; label: MessageKey; unit?: string }[] = [
  { name: "averageFrictionCoefficient", label: "ui.averageFrictionCoefficient" },
  { name: "stableFrictionCoefficient", label: "ui.stableFrictionCoefficient" },
  { name: "wearScarDiameterValue", label: "ui.wearScarDiameter", unit: "µm" },
  { name: "wearScarWidthValue", label: "metric.wearScarWidth", unit: "µm" },
  { name: "initialOxidationTemperatureValue", label: "ui.initialOxidationTemperature", unit: "°C" },
  { name: "initialDecompositionTemperatureValue", label: "test.decompositionTemperature", unit: "°C" },
  { name: "extremePressureValue", label: "ui.extremePressureValue", unit: "N" },
  { name: "pbValue", label: "metric.pbValue", unit: "N" }, { name: "pdValue", label: "metric.pdValue", unit: "N" },
  { name: "viscosity40c", label: "test.viscosity40", unit: "mm²/s" },
  { name: "viscosity100c", label: "test.viscosity100", unit: "mm²/s" }
];

export default function ExperimentFields({ legacyType, leading }: { legacyType?: string; leading?: ReactNode }) {
  const { t } = useLanguage();
  const form = Form.useFormInstance();
  const type: string = Form.useWatch("testType", form) ?? legacyType ?? "";
  const selectedMode = Form.useWatch(["testParameters", "mode"], form);
  const mode = type === "TE77" ? "reciprocating" : selectedMode;
  const temperature = Form.useWatch("temperatureValue", form);
  const tribology = ["UMT", "four-ball", "TE77", "SRV", "ball-on-disk", "other"].includes(type);
  const options = TEST_TYPES.map((item) => ({ value: item.value, label: item.labelKey ? t(item.labelKey) : item.value }));
  if (legacyType && !options.some((item) => item.value === legacyType)) options.push({ value: legacyType, label: t("test.legacy", { type: legacyType }) });
  const parameter = (name: string, label: MessageKey, unit: string, required = false) => (
    <Form.Item key={name} name={["testParameters", name]} label={t(label)} preserve={false}
      rules={required ? [{ required: true, message: t("test.requiredParameter") }] : []}>
      <InputNumber min={0.000001} addonAfter={unit} style={{ width: "100%" }} />
    </Form.Item>
  );
  const conditions = <div className="experiment-form-grid">
    {type === "UMT" && <Form.Item label={t("test.mode")} name={["testParameters", "mode"]} preserve={false} rules={[{ required: true, message: t("test.requiredMode") }]}>
      <Select options={[{ value: "reciprocating", label: t("test.reciprocating") }, { value: "ball-on-disk", label: t("ui.ballOnDiskTest") }]} />
    </Form.Item>}
    {type === "TE77" && <Form.Item label={t("test.mode")}><Input value={t("test.reciprocating")} readOnly /></Form.Item>}
    {(["UMT", "TE77"].includes(type) && mode === "reciprocating") && <>
      {parameter("strokeMm", "test.stroke", "mm", true)}{parameter("frequencyHz", "test.frequency", "Hz", true)}
    </>}
    {type === "UMT" && mode === "ball-on-disk" && parameter("radiusMm", "test.radius", "mm", true)}
    {(type === "four-ball" || (type === "UMT" && mode === "ball-on-disk")) && parameter("speedRpm", "test.speed", "rpm", type === "UMT")}
    {tribology && <>
      <Form.Item label={t("ui.upperSpecimenMaterial")} name="upperMaterial" preserve={false}><Input /></Form.Item>
      <Form.Item label={t("ui.lowerSpecimenMaterial")} name="lowerMaterial" preserve={false}><Input /></Form.Item>
      <Form.Item label={t("ui.load")} name="loadValue" preserve={false}><InputNumber min={0} addonAfter="N" style={{ width: "100%" }} /></Form.Item>
    </>}
    <Form.Item label={t("ui.temperature")} name="temperatureValue" rules={type === "kinematic-viscosity" ? [{ required: true, message: t("test.viscosityTemperatureRequired") }] : []}>
      {/* i18n-exempt: fixed numeric temperatures and scientific units, identical in every language. */}
      {type === "kinematic-viscosity" ? <Select options={[{ value: 40, label: "40 °C" }, { value: 100, label: "100 °C" }]} /> : <InputNumber min={-273.15} addonAfter="°C" style={{ width: "100%" }} />}
    </Form.Item>
    <Form.Item label={t("ui.duration")} name="durationValue"><InputNumber min={0} addonAfter="min" style={{ width: "100%" }} /></Form.Item>
  </div>;
  return <>
    <div className="experiment-selector-grid">{leading}
    <Form.Item label={t("ui.testType")} name="testType" rules={[{ required: true, message: t("entry.testTypeRequired") }]}>
      <Select placeholder={t("ui.selectATestType")} options={options} onChange={() => {
        form.setFieldValue("temperatureValue", undefined);
        form.setFieldValue(["testParameters", "mode"], undefined);
      }} />
    </Form.Item>
    </div>
    <Tabs className="experiment-type-tabs" items={[
      { key: "conditions", label: t("test.conditions"), forceRender: true, children: <>
        {type === "PDSC" && <Alert type="info" showIcon message={t("test.pdscPending")} />}
        {conditions}
      </> },
      { key: "results", label: t("test.results"), forceRender: true, children: <div className="experiment-form-grid">
        {RESULTS.filter((field) => performanceFields(type, temperature).includes(field.name)).map((field) => <Form.Item key={field.name} label={t(field.label)} name={field.name} preserve={false}>
          <InputNumber addonAfter={field.unit} style={{ width: "100%" }} />
        </Form.Item>)}
        <Form.Item label={t("ui.repeatCount")} name="repeatCount"><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>
      </div> },
      { key: "record", label: t("test.record"), forceRender: true, children: <><div className="experiment-form-grid">
    <Form.Item label={t("test.ambientTemperature")} name={["testParameters", "ambientTemperatureC"]}><InputNumber min={-273.15} addonAfter="°C" style={{ width: "100%" }} /></Form.Item>
    <Form.Item label={t("test.humidity")} name={["testParameters", "humidityPercent"]}><InputNumber min={0} max={100} addonAfter="%" style={{ width: "100%" }} /></Form.Item>

        <Form.Item label={t("ui.testStandard")} name="testStandard"><Input /></Form.Item>
        <Form.Item label={t("ui.instrument")} name="instrument"><Input /></Form.Item>
        <Form.Item label={t("ui.experimentDate")} name="experimentDate"><Input type="date" /></Form.Item>
        <Form.Item label={t("ui.operator")} name="operator"><Input /></Form.Item>
        <Form.Item label={t("ui.notes")} name="notes"><Input /></Form.Item>
      </div><Alert type="info" showIcon message={t("test.environmentHelp")} /></> }
    ]} />
  </>;
}
