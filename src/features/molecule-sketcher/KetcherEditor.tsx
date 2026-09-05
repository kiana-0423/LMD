import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import type { Ketcher } from "ketcher-core";
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
import { coded } from "../../lib/backendErrors";

type KetcherApi = Pick<Ketcher, "getSmiles" | "getMolfile" | "setMolecule" | "editor">;

export type KetcherEditorHandle = {
  getSmiles: () => Promise<string>;
  getMolfile: () => Promise<string>;
  setMolecule: (content: string, format: "smiles" | "molfile") => Promise<void>;
  clear: () => Promise<void>;
};

type Props = {
  loading?: boolean;
  toolbar?: ReactNode;
  onReady?: (ready: boolean) => void;
  onEdit?: () => void;
  onChange?: (state: { smiles: string; molfile: string }) => void;
};

const KetcherEditor = forwardRef<KetcherEditorHandle, Props>(({ loading, toolbar, onReady, onEdit, onChange }, ref) => {
  const { t } = useLanguage();
  const ketcherRef = useRef<KetcherApi>();
  const [ready, setReady] = useState(false);
  const [errorText, setErrorText] = useState("");
  const structServiceProvider = useMemo(() => new StandaloneStructServiceProvider(), []);
  const callbacks = useRef({ onReady, onEdit, onChange });
  callbacks.current = { onReady, onEdit, onChange };
  const changeVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const shell = useRef<HTMLDivElement>(null);
  const notifyRef = useRef(notifyChange);
  notifyRef.current = notifyChange;

  useEffect(() => {
    shell.current?.toggleAttribute("inert", Boolean(loading));
  }, [loading]);

  useEffect(() => {
    const ketcher = ketcherRef.current;
    if (!ready || !ketcher) return;
    callbacks.current.onReady?.(true);
    const subscriber = ketcher.editor.subscribe("change", () => {
      changeVersion.current += 1;
      callbacks.current.onEdit?.();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { void notifyRef.current(); }, 250);
    });
    return () => {
      changeVersion.current += 1;
      clearTimeout(timer.current);
      ketcher.editor.unsubscribe("change", subscriber);
      callbacks.current.onReady?.(false);
    };
  }, [ready]);

  async function readStructure() {
    const ketcher = ketcherRef.current;
    if (!ketcher) return { smiles: "", molfile: "" };
    const [smiles, molfile] = await Promise.all([
      ketcher.getSmiles().catch(() => ""),
      ketcher.getMolfile().catch(() => "")
    ]);
    return { smiles: smiles.trim(), molfile };
  }

  async function notifyChange() {
    const version = changeVersion.current;
    const structure = await readStructure();
    if (version === changeVersion.current) callbacks.current.onChange?.(structure);
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
      if (!ketcherRef.current) throw new Error(coded("structure.processingFailed", "Ketcher is not ready yet."));
      if (!content.trim()) throw new Error(coded("structure.processingFailed", "No structure to load into Ketcher."));
      await ketcherRef.current.setMolecule(content);
      clearTimeout(timer.current);
      await notifyChange();
    },
    async clear() {
      if (ketcherRef.current) {
        await ketcherRef.current.setMolecule("");
      }
      callbacks.current.onChange?.({ smiles: "", molfile: "" });
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
      {toolbar}
      <div ref={shell} className="ketcher-shell" data-i18n-ketcher aria-busy={loading}>
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
