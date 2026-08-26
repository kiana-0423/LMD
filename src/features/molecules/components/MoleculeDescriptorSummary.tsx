import { Button, Card, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { descriptorStatusLabelKeys } from "../../../lib/constants";
import type { Molecule } from "../../../types";
import { useLanguage } from "../../../i18n/LanguageContext";

export default function MoleculeDescriptorSummary({ molecule }: { molecule: Molecule }) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <Card size="small" title={t("ui.descriptorSummary")}>
      <Space direction="vertical" size={12}>
        <Space wrap>
          <Tag color={molecule.descriptorReady ? "green" : "red"}>
            {molecule.descriptorReady ? t("ui.descriptorsReady"): t("ui.descriptorsNotReady")}
          </Tag>
          <Tag>{`RDKit: ${t(descriptorStatusLabelKeys[molecule.rdkitDescriptorStatus] ?? "label.missing")}`}</Tag>
          <Tag>{`Mordred: ${t(descriptorStatusLabelKeys[molecule.mordredDescriptorStatus] ?? "label.missing")}`}</Tag>
        </Space>
        <Typography.Text type="secondary">{t("ui.viewTheCompleteRdkitAndMordredDescriptorsIn")}</Typography.Text>
        <Button type="primary" onClick={() => navigate("/descriptors")}>{t("ui.openDescriptorCenter")}</Button>
      </Space>
    </Card>
  );
}
