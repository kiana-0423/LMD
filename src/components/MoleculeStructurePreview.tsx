import { Card } from "antd";

export default function MoleculeStructurePreview({ svg, title }: { svg?: string; title?: string }) {
  return (
    <Card title={title || "2D 结构预览"} size="small" className="structure-preview-card">
      {svg ? (
        <div className="structure-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="structure-preview placeholder">结构预览将在此显示。</div>
      )}
    </Card>
  );
}
