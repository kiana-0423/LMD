import { Card } from "antd";
import { useLanguage } from "../i18n/LanguageContext";

export default function MoleculeStructurePreview({ svg, title }: { svg?: string; title?: string }) {
  const { t } = useLanguage();
  return (
    <Card title={title || t("ui.2dStructurePreview")} size="small" className="structure-preview-card">
      {svg ? (
        <div className="structure-preview">
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt={title || t("ui.2dMolecularStructure")}
          />
        </div>
      ) : (
        <div className="structure-preview placeholder">{t("ui.theStructurePreviewWillAppearHere")}</div>
      )}
    </Card>
  );
}
