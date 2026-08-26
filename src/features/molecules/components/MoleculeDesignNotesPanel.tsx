import { Card, Typography } from "antd";
import type { Molecule } from "../../../types";
import { useLanguage } from "../../../i18n/LanguageContext";

export default function MoleculeDesignNotesPanel({ molecule }: { molecule: Molecule }) {
  const { t } = useLanguage();
  return (
    <Card size="small" title={t("ui.moleculeOverview")}>
      <Typography.Paragraph>
        {molecule.notes ? <span translate="no">{molecule.notes}</span> : t("ui.noMoleculeOverviewAvailable")}
      </Typography.Paragraph>
    </Card>
  );
}
