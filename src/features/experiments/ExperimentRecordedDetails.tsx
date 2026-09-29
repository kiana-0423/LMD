import { Button, Card, Descriptions, Form, Space } from "antd";
import { useLanguage } from "../../i18n/LanguageContext";
import { performanceFields } from "../../lib/experimentProtocol";
import type { Experiment, PerformanceResult } from "../../types";
import ExperimentFields from "./ExperimentFields";

export default function ExperimentRecordedDetails({
  item,
  result,
  editing,
  saving = false,
  onEdit,
  onCancelEdit,
  onClose,
  onSave
}: {
  item: Experiment;
  result?: PerformanceResult;
  editing: boolean;
  saving?: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useLanguage();
  const initialValues = {
    ...result,
    ...item,
    testParameters: {
      ...item.testParameters,
      ambientTemperatureC:
        item.testParameters?.environmentProvenance?.ambientTemperatureC?.source === "mean"
          ? null
          : item.testParameters?.ambientTemperatureC,
      humidityPercent:
        item.testParameters?.environmentProvenance?.humidityPercent?.source === "mean"
          ? null
          : item.testParameters?.humidityPercent
    },
    testType: item.testType,
    testStandard: item.testStandard,
    instrument: item.instrument,
    upperMaterial: item.upperMaterial,
    lowerMaterial: item.lowerMaterial,
    loadValue: item.loadValue,
    temperatureValue: item.temperatureValue,
    durationValue: item.durationValue,
    averageFrictionCoefficient: result?.averageFrictionCoefficient,
    stableFrictionCoefficient: result?.stableFrictionCoefficient,
    wearScarDiameterValue: result?.wearScarDiameterValue,
    initialOxidationTemperatureValue: result?.initialOxidationTemperatureValue,
    extremePressureValue: result?.extremePressureValue
  };

  if (editing) {
    return (
      <Card size="small" title={`${item.id} · ${t("ui.correctExperimentalData")}`} className="detail-data-card">
        <Form layout="vertical" initialValues={initialValues} onFinish={onSave}>
          <ExperimentFields legacyType={item.testType} />
          <Space className="modal-action-row">
            <Button onClick={onCancelEdit}>{t("ui.cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t("ui.saveCorrection")}
            </Button>
          </Space>
        </Form>
      </Card>
    );
  }

  return (
    <Card size="small" title={`${item.id} · ${item.formulationName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label={t("ui.testId")}>{item.id}</Descriptions.Item>
        <Descriptions.Item label={t("ui.enteredAt")}>{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationId")}>{item.formulationId}</Descriptions.Item>
        <Descriptions.Item label={t("ui.formulationName")}>{item.formulationName}</Descriptions.Item>
        <Descriptions.Item label={t("ui.testType")}>{item.testType}</Descriptions.Item>
        <Descriptions.Item label={t("ui.testStandard")}>{item.testStandard || "-"}</Descriptions.Item>
        {item.testParameters?.mode && (
          <Descriptions.Item label={t("test.mode")}>
            {t(item.testParameters.mode === "reciprocating" ? "test.reciprocating" : "ui.ballOnDiskTest")}
          </Descriptions.Item>
        )}
        {(
          [
            ["strokeMm", "test.stroke", "mm"],
            ["frequencyHz", "test.frequency", "Hz"],
            ["radiusMm", "test.radius", "mm"],
            ["speedRpm", "test.speed", "rpm"],
            ["ambientTemperatureC", "test.ambientTemperature", "°C"],
            ["humidityPercent", "test.humidity", "%"]
          ] as const
        ).map(([key, label, unit]) =>
          item.testParameters?.[key] != null ? (
            <Descriptions.Item key={key} label={t(label)}>
              {item.testParameters[key]} {unit}{" "}
              {item.testParameters.environmentProvenance?.[key]?.source === "mean"
                ? t("test.meanValue", { count: item.testParameters.environmentProvenance[key].sampleCount ?? 0 })
                : ""}
            </Descriptions.Item>
          ) : null
        )}
        {result?.initialDecompositionTemperatureValue != null && (
          <Descriptions.Item label={t("test.decompositionTemperature")}>
            {result.initialDecompositionTemperatureValue} °C
          </Descriptions.Item>
        )}
        {result?.viscosity40c != null && (
          <Descriptions.Item label={t("test.viscosity40")}>{result.viscosity40c} mm²/s</Descriptions.Item>
        )}
        {result?.viscosity100c != null && (
          <Descriptions.Item label={t("test.viscosity100")}>{result.viscosity100c} mm²/s</Descriptions.Item>
        )}

        <Descriptions.Item label={t("ui.instrument")}>{item.instrument || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.upperSpecimenMaterial")}>{item.upperMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.lowerSpecimenMaterial")}>{item.lowerMaterial || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.load")}>
          {item.loadValue ?? "-"} {item.loadUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.temperature")}>
          {item.temperatureValue ?? "-"} {item.temperatureUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.duration")}>
          {item.durationValue ?? "-"} {item.durationUnit ?? ""}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.experimentDate")}>{item.experimentDate || "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.operator")}>{item.operator || "-"}</Descriptions.Item>
        {(
          [
            ["averageFrictionCoefficient", "ui.averageFrictionCoefficient", ""],
            ["stableFrictionCoefficient", "ui.stableFrictionCoefficient", ""],
            ["wearScarDiameterValue", "ui.wearScarDiameter", "µm"],
            ["wearScarWidthValue", "metric.wearScarWidth", "µm"],
            ["initialOxidationTemperatureValue", "ui.initialOxidationTemperature", "°C"],
            ["extremePressureValue", "ui.extremePressureValue", "N"],
            ["pbValue", "metric.pbValue", "N"],
            ["pdValue", "metric.pdValue", "N"]
          ] as const
        )
          .filter(
            ([key]) => performanceFields(item.testType, item.temperatureValue).includes(key) || result?.[key] != null
          )
          .map(([key, label, unit]) => (
            <Descriptions.Item key={key} label={t(label)}>
              {result?.[key] ?? "-"} {unit}
            </Descriptions.Item>
          ))}
        <Descriptions.Item label={t("ui.repeatCount")}>{result?.repeatCount ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={t("ui.notes")} span={2}>
          {item.notes || result?.notes || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("ui.updated")}>{item.updatedAt}</Descriptions.Item>
        <Descriptions.Item label={t("ui.performanceUpdated")}>{result?.updatedAt ?? "-"}</Descriptions.Item>
      </Descriptions>
      <Space className="modal-action-row">
        <Button onClick={onClose}>{t("ui.close")}</Button>
        <Button type="primary" onClick={onEdit}>
          {t("ui.correct")}
        </Button>
      </Space>
    </Card>
  );
}
