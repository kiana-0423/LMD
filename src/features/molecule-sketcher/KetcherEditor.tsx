import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Space, Spin, Tag, Typography } from "antd";
import { Editor } from "ketcher-react";
/**
 * The separate-asset Indigo build, not the default entry.
 *
 * `ketcher-standalone`'s main entry inlines the whole Indigo WebAssembly module as a Base64 string
 * inside a 16 MB JavaScript file. That has to be parsed as JavaScript and decoded before anything
 * can run, it cannot be cached or streamed as WebAssembly, and it lands in whichever chunk imports
 * it. `dist/binaryWasmNoRender` instead ships the worker and the `.wasm` as their own files, which
 * Vite emits as separate assets and the browser fetches — from the application's own bundle, over
 * the Tauri custom protocol, with no network involved.
 *
 * `NoRender` rather than `binaryWasm`: the `-norender` Indigo build (5.0 MB against 8.5 MB) leaves
 * out server-side image rendering, which LMD never asks for. Ketcher draws the structure itself in
 * the browser, and every conversion LMD performs — SMILES, Molfile, InChI, layout, clean-up — is
 * done either by Ketcher's own code or by the RDKit sidecar.
 */
import { StandaloneStructServiceProvider } from "ketcher-standalone/dist/binaryWasmNoRender";
import "ketcher-react/dist/index.css";
import { useLanguage } from "../../i18n/LanguageContext";
import KetcherTranslationBridge from "./KetcherTranslationBridge";

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
  const { t } = useLanguage();
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
      title={t("ui.moleculeEditor")}
      className="ketcher-card"
      extra={
        <Space>
          <Tag color={ready ? "green" : "blue"}>{ready ? t("ui.ketcherReady"): t("ui.loadingKetcher")}</Tag>
          <Button size="small" disabled={loading || !ready} onClick={() => ketcherRef.current?.setMolecule("CCO").then(notifyChange)}>{t("ui.exampleEthanol")}</Button>
          <Button size="small" disabled={loading || !ready} onClick={() => ketcherRef.current?.setMolecule("").then(() => onChange?.({ smiles: "", molfile: "" }))}>{t("ui.clear")}</Button>
        </Space>
      }
    >
      {errorText && (
        <Alert
          className="ketcher-alert"
          type="error"
          showIcon
          message={t("ui.ketcherInitializationFailed")}
          // Ketcher's own diagnostic, from a third-party bundle. It has no code to translate and
          // is what a user quotes when reporting the failure, so it is shown exactly as it came.
          description={<span translate="no">{errorText}</span>}
        />
      )}
      {/* Mounted here rather than at the application root: this is the only DOM in the whole
          application that LMD does not render itself, so it is the only DOM the bridge has ever
          had anything to do. */}
      <KetcherTranslationBridge />
      <div className="ketcher-shell" data-i18n-ketcher>
        {!ready && (
          <div className="ketcher-loading">
            <Spin />
            <Typography.Text type="secondary">{t("ui.loadingTheKetcherMoleculeEditor")}</Typography.Text>
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
