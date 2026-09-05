import { InputNumber, Select, Space, Typography } from "antd";
import { useLanguage } from "../../i18n/LanguageContext";
import type { CandidateConstraints } from "../../lib/api";

const ELEMENTS = ["C", "H", "B", "N", "O", "F", "Si", "P", "S", "Cl", "Br"];

export default function CandidateConstraintsForm({ value, onChange }: {
  value: CandidateConstraints;
  onChange: (value: CandidateConstraints) => void;
}) {
  const { t } = useLanguage();
  return (
    <Space direction="vertical" size={10} style={{ width: "100%", gridColumn: "1 / -1" }}>
      <Typography.Text type="secondary">{t("design.candidateConstraintsHelp")}</Typography.Text>
      <Select
        mode="multiple"
        maxTagCount="responsive"
        style={{ width: "100%" }}
        aria-label={t("design.permittedElements")}
        value={value.permittedElements}
        options={ELEMENTS.map((element) => ({ value: element, label: element }))}
        onChange={(elements) => onChange({ ...value, permittedElements: elements })}
      />
      <Space wrap>
        <span>{t("design.heavyAtomsRange")}</span>
        <InputNumber min={1} max={120} aria-label={t("design.minHeavyAtoms")} value={value.minHeavyAtoms} onChange={(next) => onChange({ ...value, minHeavyAtoms: next ?? 1 })} />
        <span>–</span>
        <InputNumber min={1} max={120} aria-label={t("design.maxHeavyAtoms")} value={value.maxHeavyAtoms} onChange={(next) => onChange({ ...value, maxHeavyAtoms: next ?? 60 })} />
        <span>{t("design.maxBranchPoints")}</span>
        <InputNumber min={0} max={120} aria-label={t("design.maxBranchPoints")} value={value.maxBranchPoints} onChange={(next) => onChange({ ...value, maxBranchPoints: next ?? 0 })} />
      </Space>
    </Space>
  );
}
