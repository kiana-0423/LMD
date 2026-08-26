import { Alert, Empty, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import LoadingBlock from "../../../components/LoadingBlock";
import { useLanguage, type MessageKey } from "../../../i18n/LanguageContext";
import { listFormulationsForMolecule } from "../../../lib/api";
import type { FormulationUsage } from "../../../types";
import { backendErrorText } from "../../../lib/backendErrors";

const ROLE_KEYS: Record<FormulationUsage["role"], MessageKey> = {
  component: "usage.roleComponent",
  additive: "usage.roleAdditive",
  base_oil: "usage.roleBaseOil"
};

/**
 * Every formulation that uses this molecule, read from the workspace database when the tab is
 * opened. There are no fixed rows here: an unused molecule shows an empty state.
 */
export default function FormulationUsageTable({ moleculeId }: { moleculeId: string }) {
  const { t } = useLanguage();
  /** Renders a measured value, or says plainly that nothing was recorded. */
  const measured = (value: number | null, unit = "") =>
    value === null || value === undefined ? (
      <span className="muted">{t("formulation.notRecorded")}</span>
    ) : (
      // Numbers and units are data, not prose.
      <span translate="no">{`${value}${unit ? ` ${unit}` : ""}`}</span>
    );
  const [rows, setRows] = useState<FormulationUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listFormulationsForMolecule(moleculeId)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught) => {
        // The raw message is stored and translated at render, so switching language re-reads a
        // failure that has already happened rather than leaving it in the previous one.
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [moleculeId]);

  const columns: ColumnsType<FormulationUsage> = [
    {
      title: t("usage.formulation"),
      dataIndex: "formulationName",
      render: (value: string) => <span translate="no">{value}</span>
    },
    {
      title: t("usage.role"),
      dataIndex: "role",
      width: 150,
      render: (value: FormulationUsage["role"]) => <Tag>{ROLE_KEYS[value] ? t(ROLE_KEYS[value]) : value}</Tag>
    },
    {
      title: t("usage.concentration"),
      width: 220,
      render: (_, row) => {
        const recorded = (row.concentrations ?? []).filter((entry) => entry.value !== null);
        if (recorded.length === 0) return measured(null);
        // A total is shown only when the backend confirmed every unit matches.
        if (recorded.length > 1 && row.totalConcentration !== null) {
          return (
            <span translate="no">
              {`${row.totalConcentration} ${row.concentrationUnit}`.trim()}
              {` (${recorded.length}x)`}
            </span>
          );
        }
        // Otherwise each component is listed, so mixed units are never added together.
        return (
          <span translate="no">
            {recorded.map((entry) => `${entry.value} ${entry.unit}`.trim()).join(" + ")}
          </span>
        );
      }
    },
    { title: t("usage.experiments"), dataIndex: "experimentCount", width: 160 },
    {
      title: t("usage.bestFriction"),
      width: 140,
      render: (_, row) => measured(row.bestAverageFrictionCoefficient)
    },
    {
      title: t("usage.bestWear"),
      width: 150,
      render: (_, row) => measured(row.bestWearScarDiameter, "um")
    },
    {
      title: t("usage.oxidation"),
      width: 130,
      render: (_, row) => measured(row.highestOxidationTemperature, "C")
    },
    {
      title: t("usage.extremePressure"),
      width: 160,
      render: (_, row) => measured(row.bestExtremePressureValue, "N")
    }
  ];

  if (loading) return <LoadingBlock />;
  if (error) {
    return (
      <Alert type="error" showIcon message={t("usage.loadFailed")} description={backendErrorText(error, t)} />
    );
  }
  if (rows.length === 0) {
    return <Empty description={t("usage.empty")} />;
  }
  return (
    <Table
      size="small"
      rowKey={(row) => `${row.formulationId}-${row.role}`}
      columns={columns}
      dataSource={rows}
      scroll={{ x: true }}
      pagination={{ pageSize: 8, showSizeChanger: false }}
    />
  );
}
