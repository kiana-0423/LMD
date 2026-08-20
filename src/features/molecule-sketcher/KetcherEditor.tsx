import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Space, Spin, Tag, Typography } from "antd";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

type KetcherApi = {
  getSmiles: () => Promise<string>;
  getMolfile: () => Promise<string>;
  setMolecule: (structure: string) => Promise<void | undefined>;
};

export type KetcherEditorHandle = {
  getSmiles: () => Promise<string>;
  getMolfile: () => Promise<string>;
  setMolecule: (content: string, format: "smiles" | "molfile") => Promise<void>;
  clear: () => Promise<void>;
};

type Props = {
  loading?: boolean;
  onChange?: (state: { smiles: string; molfile: string }) => void;
};

const KetcherEditor = forwardRef<KetcherEditorHandle, Props>(({ loading, onChange }, ref) => {
  const ketcherRef = useRef<KetcherApi>();
  const [ready, setReady] = useState(false);
  const [errorText, setErrorText] = useState("");
  const structServiceProvider = useMemo(() => new StandaloneStructServiceProvider(), []);

  async function readStructure() {
    const ketcher = ketcherRef.current;
    if (!ketcher) return { smiles: "", molfile: "" };
    const [smiles, molfile] = await Promise.all([
      ketcher.getSmiles().catch(() => ""),
      ketcher.getMolfile().catch(() => "")
    ]);
    return { smiles: smiles.trim(), molfile: molfile.trim() };
  }

  async function notifyChange() {
    const structure = await readStructure();
    onChange?.(structure);
    return structure;
  }

  useImperativeHandle(ref, () => ({
    async getSmiles() {
      return (await readStructure()).smiles;
    },
    async getMolfile() {
      return (await readStructure()).molfile;
    },
    async setMolecule(content) {
      if (!ketcherRef.current || !content.trim()) return;
      await ketcherRef.current.setMolecule(content);
      await notifyChange();
    },
    async clear() {
      if (ketcherRef.current) {
        await ketcherRef.current.setMolecule("");
      }
      onChange?.({ smiles: "", molfile: "" });
    }
  }));

  return (
    <Card
      title="Molecule Editor"
      className="ketcher-card"
      extra={
        <Space>
          <Tag color={ready ? "green" : "blue"}>{ready ? "Ketcher ready" : "Loading Ketcher"}</Tag>
          <Button size="small" disabled={loading || !ready} onClick={() => ketcherRef.current?.setMolecule("CCO").then(notifyChange)}>
            Example: Ethanol
          </Button>
          <Button size="small" disabled={loading || !ready} onClick={() => ketcherRef.current?.setMolecule("").then(() => onChange?.({ smiles: "", molfile: "" }))}>
            Clear
          </Button>
        </Space>
      }
    >
      {errorText && (
        <Alert
          className="ketcher-alert"
          type="error"
          showIcon
          message="Ketcher initialization failed"
          description={errorText}
        />
      )}
      <div className="ketcher-shell">
        {!ready && (
          <div className="ketcher-loading">
            <Spin />
            <Typography.Text type="secondary">Loading the Ketcher molecule editor...</Typography.Text>
          </div>
        )}
        <Editor
          staticResourcesUrl="/"
          structServiceProvider={structServiceProvider}
          disableMacromoleculesEditor
          errorHandler={(message) => setErrorText(message)}
          onInit={(ketcher) => {
            ketcherRef.current = ketcher;
            setReady(true);
            setErrorText("");
          }}
        />
      </div>
    </Card>
  );
});

export default KetcherEditor;
