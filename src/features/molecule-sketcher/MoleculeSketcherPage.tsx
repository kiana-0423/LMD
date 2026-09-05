import { Alert, Button, Card, Descriptions, Dropdown, Form, Input, Modal, Select, Space, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { getMolecule } from "../../lib/api";
import { additiveFunctionLabelKeys, moleculeCategories, moleculeCategoryLabelKeys } from "../../lib/constants";
import {
  calculateSketcherDescriptors,
  checkMoleculeDuplicate,
  importNewMolecule,
  importSketcherStructure,
  molfileToSmiles,
  smilesToMolfile,
  validateSketcherSmiles
} from "../../lib/moleculeSketcherApi";
import type { ImportNewMoleculePayload, MoleculeCategory, SketcherDescriptorResult, SketcherValidationResult } from "../../types";
import KetcherEditor, { type KetcherEditorHandle } from "./KetcherEditor";
import { useLanguage, type MessageKey } from "../../i18n/LanguageContext";
import { coded, describeBackendError } from "../../lib/backendErrors";

/** How a stored molecule was created. Keys, not labels: the text is resolved when it renders, so
 *  switching language relabels it. */
/** Stable codes for what can go wrong in the sketcher, so the message can be translated. */
const SKETCHER_ERRORS = {
  needsStructure: "sketcher.needsStructure",
  needsCanonical: "sketcher.needsCanonical",
  needsSmiles: "sketcher.needsSmiles",
  invalidSmiles: "sketcher.invalidSmiles",
  descriptorFailed: "sketcher.descriptorFailed",
  saveFailed: "sketcher.saveFailed",
  saveCancelled: "sketcher.saveCancelled"
} as const;

const SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  ketcher: "ui.ketcherDrawing",
  smiles_input: "ui.smilesInput",
  molfile_input: "ui.molfileInput",
  library_edit: "ui.moleculeLibraryEdit"
};

export default function MoleculeSketcherPage() {
  const { t } = useLanguage();
  const editorRef = useRef<KetcherEditorHandle>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<MoleculeCategory>("candidate");
  const [tags, setTags] = useState<string[]>([]);
  const [inputSmiles, setInputSmiles] = useState("");
  const [canonicalSmiles, setCanonicalSmiles] = useState("");
  const [originalSmiles, setOriginalSmiles] = useState("");
  const [molfile, setMolfile] = useState("");
  const [metadata, setMetadata] = useState<SketcherValidationResult>();
  const [descriptorResult, setDescriptorResult] = useState<SketcherDescriptorResult>();
  // Held as a key, not as text: a status set in one language must follow a switch to another.
  const [statusKey, setStatusKey] = useState<MessageKey>("sketcher.notSaved");
  const [failure, setFailure] = useState<{ summary: string; detail: string }>();
  const [loadingAction, setLoadingAction] = useState<string>();
  const [infoTab, setInfoTab] = useState("information");
  const [editorReady, setEditorReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadingDepth = useRef(0);
  const canvasRevision = useRef(0);
  const canvasActive = useRef(false);
  const [canvasStructure, setCanvasStructure] = useState<{ smiles: string; molfile: string }>();
  const [importReview, setImportReview] = useState<{ filename: string; format: "pdb" | "mol2"; bondIds: string[]; normalizedAtomTypes: string[] }>();

  function canvasEdited() {
    canvasActive.current = true;
    canvasRevision.current += 1;
    setCanonicalSmiles("");
    setMetadata(undefined);
    setDescriptorResult(undefined);
    setFailure(undefined);
    setStatusKey("sketcher.notSaved");
  }

  function canvasChanged(structure: { smiles: string; molfile: string }) {
    setInputSmiles(structure.smiles);
    setMolfile(structure.molfile);
    setCanvasStructure(structure);
  }

  useEffect(() => {
    if (!canvasStructure) return;
    const version = canvasRevision.current;
    let cancelled = false;
    if (!canvasStructure.smiles && !canvasStructure.molfile) return;
    const timer = setTimeout(() => {
      const request = canvasStructure.smiles
        ? validateSketcherSmiles(canvasStructure.smiles) : molfileToSmiles(canvasStructure.molfile);
      void request.then((result) => {
        if (cancelled || version !== canvasRevision.current) return;
        if (result.valid) {
          setMetadata(result);
          setCanonicalSmiles(result.canonicalSmiles || result.smilesCanonical || "");
        }
      }).catch((error) => {
        if (!cancelled && version === canvasRevision.current) setFailure(describeBackendError(error, t));
      });
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canvasStructure, t]);

  useEffect(() => {
    const moleculeId = searchParams.get("moleculeId");
    if (!moleculeId || !editorReady) return;
    getMolecule(moleculeId).then(async (molecule) => {
      if (!molecule) return;
      setName(molecule.name);
      setCategory(molecule.category);
      setTags(molecule.tags ?? molecule.additiveFunctionTags ?? []);
      setCanonicalSmiles(molecule.smilesCanonical);
      setOriginalSmiles(molecule.smilesRaw || molecule.smilesCanonical);
      setMolfile(molecule.molfile ?? molecule.molBlock ?? "");
      setMetadata({
        valid: true,
        canonicalSmiles: molecule.smilesCanonical,
        smilesCanonical: molecule.smilesCanonical,
        formula: molecule.formula,
        molecularWeight: molecule.molecularWeight,
        inchiKey: molecule.inchiKey,
        inchikey: molecule.inchiKey
      });
      await editorRef.current?.setMolecule(molecule.molfile || molecule.molBlock || molecule.smilesCanonical, molecule.molfile || molecule.molBlock ? "molfile" : "smiles");
      setStatusKey("sketcher.loadedFromLibrary");
    });
  }, [searchParams, editorReady]);

  const descriptorPreview = useMemo(
    () => Object.entries(descriptorResult?.preview ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ""),
    [descriptorResult]
  );
  const visibleDescriptorPreview = descriptorPreview.slice(0, 4);

  /**
   * Runs a button's action, recording any failure in the panel above.
   *
   * The error is re-thrown so a caller that chains onto this one stops as well; a handler wired
   * straight to a button uses `handle` below instead, because an unhandled rejection escaping a
   * click is a real defect, not a test artifact.
   */
  async function withLoading<T>(action: string, task: () => Promise<T>) {
    if (loadingDepth.current++ === 0) setLoadingAction(action);
    setFailure(undefined);
    try {
      return await task();
    } catch (error) {
      // The code names the situation and is translated; the detail is whatever the sidecar or the
      // backend said, and is shown untouched because that is what makes it actionable.
      setFailure(describeBackendError(error, t));
      setInfoTab("status");
      throw error;
    } finally {
      if (--loadingDepth.current === 0) setLoadingAction(undefined);
    }
  }

  /**
   * Wraps an action for direct use as an event handler.
   *
   * The failure is already on screen by the time this swallows it — `withLoading` put it there.
   */
  function handle(task: () => Promise<unknown>) {
    return () => {
      void task().catch(() => undefined);
    };
  }

  async function readStructureOrFail() {
    const editorSmiles = (await editorRef.current?.getSmiles()) || "";
    const smiles = (canvasActive.current ? editorSmiles : editorSmiles || inputSmiles || canonicalSmiles).trim();
    const editorMolfile = await editorRef.current?.getMolfile();
    const currentMolfile = canvasActive.current ? editorMolfile || "" : editorMolfile || molfile;
    if (!smiles && !currentMolfile) {
      throw new Error(coded(SKETCHER_ERRORS.needsStructure, "No SMILES and no drawn structure."));
    }
    return { smiles, molfile: currentMolfile };
  }

  async function generateSmiles() {
    return withLoading("generate", async () => {
      const version = canvasRevision.current;
      const structure = await readStructureOrFail();
      let result: SketcherValidationResult;
      if (structure.smiles) {
        result = await validateSketcherSmiles(structure.smiles);
        setOriginalSmiles(structure.smiles);
      } else {
        result = await molfileToSmiles(structure.molfile);
        setMolfile(structure.molfile);
      }
      if (version !== canvasRevision.current) throw new Error(coded("structure.processingFailed", "The canvas changed during validation. Generate SMILES again."));
      if (!result.valid) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, result.error ?? ""));
      setMetadata(result);
      const canonical = result.canonicalSmiles || result.smilesCanonical || "";
      if (!canonical.trim()) throw new Error(coded(SKETCHER_ERRORS.needsCanonical, ""));
      setCanonicalSmiles(canonical);
      setMolfile(structure.molfile);
      setStatusKey("sketcher.canonicalGenerated");
      setInfoTab("status");
      return result;
    });
  }

  async function loadFromSmiles() {
    await withLoading("load", async () => {
      const smiles = inputSmiles.trim();
      if (!smiles) throw new Error(coded(SKETCHER_ERRORS.needsSmiles, ""));
      const validation = await validateSketcherSmiles(smiles);
      if (!validation.valid) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, validation.error ?? ""));
      const mol = await smilesToMolfile(smiles);
      await editorRef.current?.setMolecule(String(mol.molfile ?? ""), "molfile");
      setOriginalSmiles(smiles);
      setCanonicalSmiles(validation.canonicalSmiles || validation.smilesCanonical || "");
      setMolfile(String(mol.molfile ?? ""));
      setMetadata(validation);
      setStatusKey("sketcher.structureLoaded");
    });
  }

  async function validateMolecule() {
    await withLoading("validate", async () => {
      const result = await generateSmiles();
      if (!result?.valid) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, result?.error ?? ""));
      message.success(t("ui.molecularStructureValidated"));
    });
  }

  async function calculateDescriptors(allowFailure = false) {
    return withLoading("descriptors", async () => {
      const validation = await generateSmiles();
      const smiles = validation.canonicalSmiles || validation.smilesCanonical || "";
      if (!smiles) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, ""));
      const descriptors = await calculateSketcherDescriptors(smiles);
      setDescriptorResult(descriptors);
      setInfoTab("status");
      if (!descriptors.valid && !allowFailure) {
        throw new Error(coded(SKETCHER_ERRORS.descriptorFailed, descriptors.error ?? ""));
      }
      setStatusKey(
        descriptors.valid ? "ui.descriptorCalculationComplete" : "sketcher.descriptorFailed"
      );
      return descriptors;
    });
  }

  async function saveToLibrary(viewAfterSave = false) {
    const result = await saveMolecule("manual_save");
    if (result?.moleculeId && viewAfterSave) navigate("/molecules");
  }

  async function importAsNewMolecule() {
    const result = await saveMolecule("new_import", true);
    if (!result?.success) return;
    Modal.confirm({
      title: t("ui.newMoleculeImportedSuccessfully"),
      content: t("ui.theNewMoleculeWasAddedToTheMolecule"),
      okText: t("ui.stayHere"),
      cancelText: t("ui.viewInMoleculeLibrary"),
      icon: null,
      onCancel: () => navigate("/molecules")
    });
  }

  async function saveMolecule(importMode: ImportNewMoleculePayload["importMode"], forceNew = false) {
    return withLoading(forceNew ? "import" : "save", async () => {
      const validation = await generateSmiles();
      if (!validation.valid) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, validation.error ?? ""));
      const canonical = validation.canonicalSmiles || validation.smilesCanonical || canonicalSmiles;
      if (!canonical.trim()) throw new Error(coded(SKETCHER_ERRORS.needsCanonical, ""));
      const inchikey = validation.inchiKey || validation.inchikey || "";
      let descriptors = descriptorResult;
      if (!descriptors) {
        await confirmContinueWithoutDescriptors();
        descriptors = await calculateDescriptors(true);
      }
      const duplicate = await checkMoleculeDuplicate(canonical, inchikey);
      let duplicateOf = "";
      let mode = importMode;
      if (duplicate.duplicate) {
        const confirmed = await confirmDuplicateImport(forceNew);
        if (!confirmed) return undefined;
        duplicateOf = duplicate.existingMoleculeId ?? "";
        if (forceNew) mode = "new_copy";
      }
      const formula = validation.formula || metadata?.formula || "";
      // i18n-exempt: becomes the stored molecule name, which is data rather than interface text.
      const moleculeName = name.trim() || (formula ? `Molecule_${formula}` : `Molecule_${Date.now()}`);
      const payload: ImportNewMoleculePayload = {
        name: moleculeName,
        category,
        tags,
        originalSmiles: originalSmiles || canonical,
        canonicalSmiles: canonical,
        molfile: (await editorRef.current?.getMolfile()) || molfile || "",
        formula,
        molecularWeight: validation.molecularWeight || metadata?.molecularWeight || 0,
        inchikey,
        descriptorJson: {
          valid: descriptors?.valid ?? false,
          descriptor_count: descriptors?.descriptorCount ?? 0,
          descriptors: descriptors?.descriptors ?? {},
          preview: descriptors?.preview ?? {},
          rdkit_status: descriptors?.rdkitStatus ?? "failed",
          mordred_status: descriptors?.mordredStatus ?? "failed",
          error: descriptors?.error ?? ""
        },
        duplicateOf,
        importMode: mode,
        source: molfile ? "molfile_input" : originalSmiles || inputSmiles ? "smiles_input" : "ketcher",
        notes: importReview ? JSON.stringify({ structureImport: importReview }) : undefined
      };
      const result = await importNewMolecule(payload);
      if (!result.success) throw new Error(coded(SKETCHER_ERRORS.saveFailed, result.error ?? ""));
      setStatusKey(forceNew ? "ui.newMoleculeImportedSuccessfully" : "ui.savedToTheMoleculeLibrary2");
      message.success(forceNew ? t("ui.newMoleculeImportedSuccessfully"): t("ui.savedToTheMoleculeLibrary"));
      return result;
    });
  }

  function confirmContinueWithoutDescriptors() {
    return new Promise<void>((resolve, reject) => {
      Modal.confirm({
        title: t("ui.calculateDescriptorsBeforeSaving"),
        content: t("ui.ifDescriptorCalculationFailsTheBasicMolecule"),
        okText: t("ui.continueSaving"),
        cancelText: t("ui.cancel"),
        onOk: () => resolve(),
        onCancel: () => reject(new Error(coded(SKETCHER_ERRORS.saveCancelled, "")))
      });
    });
  }

  function confirmDuplicateImport(forceNew: boolean) {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: forceNew
          ? t("ui.thisMoleculeMayAlreadyExistInTheMolecule"): t("ui.thisMoleculeMayAlreadyExistSaveItAnyway"),
        content: forceNew ? t("sketcher.duplicateCopyNote") : t("ui.importItAsANewMoleculeToCreate"),
        okText: t("ui.continue"),
        cancelText: t("ui.cancel"),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
  }

  async function clearCanvas() {
    canvasEdited();
    await editorRef.current?.clear();
    setInputSmiles("");
    setCanonicalSmiles("");
    setOriginalSmiles("");
    setMolfile("");
    setMetadata(undefined);
    setDescriptorResult(undefined);
    setStatusKey("sketcher.notSaved");
    setFailure(undefined);
    setInfoTab("information");
    setImportReview(undefined);
  }

  async function importStructureFile(file: File) {
    if (loadingDepth.current) return;
    await withLoading("file", async () => {
      const format = file.name.split(".").pop()?.toLowerCase();
      if (format !== "pdb" && format !== "mol2") throw new Error(t("sketcher.structureFileOnly"));
      if (!file.size) throw new Error(t("sketcher.structureFileEmpty"));
      if (file.size > 5 * 1024 * 1024) throw new Error(t("sketcher.structureFileTooLarge"));
      const result = await importSketcherStructure(await file.text(), format);
      if (!editorRef.current) throw new Error(t("ui.loadingKetcher"));
      await editorRef.current.setMolecule(result.molfile, "molfile");
      const canonical = result.validation.canonicalSmiles || result.validation.smilesCanonical || "";
      setName((previous) => previous.trim() ? previous : file.name.replace(/\.(pdb|mol2)$/i, ""));
      setInputSmiles(canonical);
      setCanonicalSmiles(canonical);
      setOriginalSmiles(canonical);
      setMolfile(result.molfile);
      setMetadata(result.validation);
      setDescriptorResult(undefined);
      setImportReview({ filename: file.name, format, bondIds: result.inferredBondIds, normalizedAtomTypes: result.normalizedAtomTypes ?? [] });
      setStatusKey("sketcher.structureLoaded");
    });
  }

  function exportData(kind: "smiles" | "molfile" | "csv") {
    const rows = {
      name,
      canonicalSmiles,
      originalSmiles,
      molfile,
      formula: metadata?.formula,
      molecularWeight: metadata?.molecularWeight,
      inchikey: metadata?.inchiKey,
      descriptors: JSON.stringify(descriptorResult?.descriptors ?? {})
    };
    const content =
      kind === "smiles"
        ? canonicalSmiles
        : kind === "molfile"
          ? molfile
          : `${Object.keys(rows).join(",")}\n${Object.values(rows)
              .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
              .join(",")}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `molecule-sketcher.${kind === "csv" ? "csv" : kind === "molfile" ? "mol" : "smi"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-grid molecule-sketcher-page">
      <PageHeader
        title={t("ui.moleculeDrawingAndSmilesGeneration")}
        description={t("ui.drawMoleculesGenerateCanonicalSmilesCalculat")}
      />
      <div className="sketcher-layout">
        <KetcherEditor ref={editorRef} loading={Boolean(loadingAction)} onReady={setEditorReady}
          onEdit={canvasEdited} onChange={canvasChanged} toolbar={
            <div className="sketcher-import-toolbar">
              <input ref={fileInput} type="file" accept=".pdb,.mol2" hidden aria-label={t("sketcher.importStructure")}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importStructureFile(file).catch(() => undefined);
                }} />
              <Typography.Text className="sketcher-canvas-formula" title={metadata?.formula}>
                {t("ui.molecularFormula")}: <span translate="no" data-testid="canvas-formula">{metadata?.formula || "—"}</span>
              </Typography.Text>
              {importReview && (importReview.format === "pdb" || importReview.bondIds.length > 0 || importReview.normalizedAtomTypes.length > 0) && (
                <Tooltip title={importReview.format === "pdb" ? t("sketcher.pdbReview") : t("sketcher.mol2Review", { count: importReview.bondIds.length, atomCount: importReview.normalizedAtomTypes.length })}>
                  <Tag tabIndex={0} color="orange">{t("sketcher.reviewBonds")}</Tag>
                </Tooltip>
              )}
              <Button className="sketcher-import-button" size="small" icon={<UploadOutlined />}
                disabled={!editorReady || Boolean(loadingAction)} loading={loadingAction === "file"}
                onClick={() => fileInput.current?.click()}>{t("sketcher.importStructure")}</Button>
            </div>
          } />
        <Card className="sketcher-info-panel">
          <Tabs activeKey={infoTab} onChange={setInfoTab} className="sketcher-info-tabs" items={[
            { key: "information", label: t("ui.moleculeInformation"), forceRender: true, children: (
          <Form layout="vertical" size="small" className="sketcher-compact-form" disabled={Boolean(loadingAction)}>
            <Form.Item label={t("ui.smilesInput")} className="sketcher-form-full">
              <Input.TextArea
                className="mono"
                rows={2}
                value={inputSmiles}
                aria-label={t("ui.smilesInput")}
                onChange={(event) => setInputSmiles(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t("ui.moleculeName")}>
              <Input
                value={name}
                aria-label={t("ui.moleculeName")}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("sketcher.namePlaceholder")}
              />
            </Form.Item>
            <Form.Item label={t("ui.moleculeCategory")}>
              <Select value={category} onChange={setCategory} options={moleculeCategories.map((value) => ({ value, label: t(moleculeCategoryLabelKeys[value]) }))} />
            </Form.Item>
            <Form.Item label={t("ui.moleculeTags")} className="sketcher-form-full">
              <Select
                mode="tags"
                maxTagCount="responsive"
                value={tags}
                onChange={setTags}
                options={Object.entries(additiveFunctionLabelKeys).map(([value, key]) => ({ value, label: t(key) }))}
                placeholder={t("ui.antiwearEsterSulfurContaining")}
              />
            </Form.Item>
          </Form>
            ) },
            { key: "status", label: t("ui.status"), forceRender: true, children: failure ? (
              <Alert type="error" showIcon message={failure.summary}
                description={failure.detail ? <Input.TextArea readOnly rows={3} value={failure.detail} translate="no" /> : undefined}
              />
            ) : (<>
          <Descriptions bordered size="small" column={2} className="sketcher-summary">
            <Descriptions.Item label={t("ui.canonicalSmiles")} span={2}><Input.TextArea readOnly rows={2} className="mono" value={canonicalSmiles || "-"} aria-label={t("ui.canonicalSmiles")} translate="no" /></Descriptions.Item>
            <Descriptions.Item label={t("ui.molecularFormula")}>{metadata?.formula || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("ui.molecularWeight")}>{metadata?.molecularWeight || "-"}</Descriptions.Item>
            <Descriptions.Item label="InChIKey" span={2}><span className="mono">{metadata?.inchiKey || "-"}</span></Descriptions.Item>
            <Descriptions.Item label={t("ui.descriptorStatus")} span={2}>
              <Tag color={descriptorResult?.valid ? "green" : descriptorResult ? "red" : "blue"}>
                {descriptorResult?.valid
                  ? `${t("sketcher.successPrefix")}: ${descriptorResult.descriptorCount}`
                  : descriptorResult
                    ? t("ui.failed")
                    : t("ui.notCalculated")}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          <div className="descriptor-preview">
            {visibleDescriptorPreview.map(([key, value]) => (
              <Tag key={key} title={`${key}: ${String(value)}`}>{key}: {String(value)}</Tag>
            ))}
            {descriptorPreview.length > visibleDescriptorPreview.length && (
              <Tag>+{descriptorPreview.length - visibleDescriptorPreview.length}</Tag>
            )}
          </div>
            </>) }
          ]} />
          <Space className="sketcher-actions" wrap>
            <Button disabled={Boolean(loadingAction)} loading={loadingAction === "generate"} onClick={handle(generateSmiles)}>{t("ui.generateSmiles")}</Button>
            <Button disabled={Boolean(loadingAction)} loading={loadingAction === "load"} onClick={handle(loadFromSmiles)}>{t("ui.loadFromSmiles")}</Button>
            <Button disabled={Boolean(loadingAction)} loading={loadingAction === "validate"} onClick={handle(validateMolecule)}>{t("ui.validate")}</Button>
            <Button disabled={Boolean(loadingAction)} loading={loadingAction === "descriptors"} onClick={handle(() => calculateDescriptors())}>{t("ui.calculateDescriptors")}</Button>
          </Space>
          <Space className="sketcher-save-actions" wrap>
            <Button type="primary" disabled={Boolean(loadingAction)} loading={loadingAction === "save"} onClick={handle(() => saveToLibrary(false))}>{t("ui.saveToMoleculeLibrary")}</Button>
            <Dropdown trigger={["click"]} menu={{ items: [
              { key: "import", label: t("ui.importAsNewMolecule"), onClick: handle(importAsNewMolecule) },
              { key: "save-view", label: t("ui.saveAndView"), onClick: handle(() => saveToLibrary(true)) },
              { type: "divider" },
              { key: "smiles", label: t("ui.exportSmiles"), onClick: () => exportData("smiles") },
              { key: "molfile", label: t("ui.exportMolfile"), onClick: () => exportData("molfile") },
              { key: "csv", label: t("ui.exportCsv"), onClick: () => exportData("csv") },
              { key: "clear", label: t("ui.clear"), onClick: handle(clearCanvas) }
            ] }} disabled={Boolean(loadingAction)}>
              <Button loading={loadingAction === "import"}>{t("ui.actions")}</Button>
            </Dropdown>
          </Space>
          <Typography.Paragraph type="secondary" className="sketcher-source-line">
            <span role="status">{t(statusKey)}</span><br />
            {t("ui.source")}:{" "}
            {t(SOURCE_LABEL_KEYS[molfile ? "molfile_input" : inputSmiles ? "smiles_input" : "ketcher"])}
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}
