import { Card } from "antd";

export default function MoleculeStructurePreview({ svg, title }: { svg?: string; title?: string }) {
  return (
    <Card title={title || "2D Structure Preview"} size="small" className="structure-preview-card">
      {svg ? (
        <div className="structure-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="structure-preview placeholder">The structure preview will appear here.</div>
      )}
    </Card>
  );
}
