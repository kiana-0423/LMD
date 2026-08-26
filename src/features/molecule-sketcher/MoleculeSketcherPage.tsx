import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { getMolecule } from "../../lib/api";
import { additiveFunctionLabelKeys, moleculeCategories, moleculeCategoryLabelKeys } from "../../lib/constants";
import {
  calculateSketcherDescriptors,
  checkMoleculeDuplicate,
  importNewMolecule,
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

  useEffect(() => {
    const moleculeId = searchParams.get("moleculeId");
    if (!moleculeId) return;
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
  }, [searchParams]);

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
    setLoadingAction(action);
    setFailure(undefined);
    try {
      return await task();
    } catch (error) {
      // The code names the situation and is translated; the detail is whatever the sidecar or the
      // backend said, and is shown untouched because that is what makes it actionable.
      setFailure(describeBackendError(error, t));
      throw error;
    } finally {
      setLoadingAction(undefined);
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
    const smiles = (editorSmiles || canonicalSmiles || inputSmiles).trim();
    const currentMolfile = ((await editorRef.current?.getMolfile()) || molfile).trim();
    if (!smiles && !currentMolfile) {
      throw new Error(coded(SKETCHER_ERRORS.needsStructure, "No SMILES and no drawn structure."));
    }
    return { smiles, molfile: currentMolfile };
  }

  async function generateSmiles() {
    return withLoading("generate", async () => {
      const structure = await readStructureOrFail();
      let result: SketcherValidationResult;
      if (structure.smiles) {
        result = await validateSketcherSmiles(structure.smiles);
        setOriginalSmiles(structure.smiles);
      } else {
        result = await molfileToSmiles(structure.molfile);
        setMolfile(structure.molfile);
      }
      if (!result.valid) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, result.error ?? ""));
      setMetadata(result);
      const canonical = result.canonicalSmiles || result.smilesCanonical || "";
      if (!canonical.trim()) throw new Error(coded(SKETCHER_ERRORS.needsCanonical, ""));
      setCanonicalSmiles(canonical);
      setStatusKey("sketcher.canonicalGenerated");
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
      const smiles = canonicalSmiles || (await generateSmiles())?.canonicalSmiles || "";
      if (!smiles) throw new Error(coded(SKETCHER_ERRORS.invalidSmiles, ""));
      const descriptors = await calculateSketcherDescriptors(smiles);
      setDescriptorResult(descriptors);
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
        molfile: molfile || (await editorRef.current?.getMolfile()) || "",
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
        source: molfile ? "molfile_input" : originalSmiles || inputSmiles ? "smiles_input" : "ketcher"
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
    await editorRef.current?.clear();
    setInputSmiles("");
    setCanonicalSmiles("");
    setOriginalSmiles("");
    setMolfile("");
    setMetadata(undefined);
    setDescriptorResult(undefined);
    setStatusKey("sketcher.notSaved");
    setFailure(undefined);
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
      {failure ? (
        <Alert
          type="error"
          showIcon
          className="error-panel"
          message={failure.summary}
          // The detail comes from the sidecar or the database and names ids, units, or paths, so
          // it stays exactly as it arrived.
          description={failure.detail ? <span translate="no">{failure.detail}</span> : undefined}
        />
      ) : null}
      <div className="sketcher-layout">
        <KetcherEditor ref={editorRef} loading={Boolean(loadingAction)} onChange={({ smiles, molfile }) => {
          setInputSmiles(smiles);
          setMolfile(molfile);
        }} />
        <Card title={t("ui.moleculeInformation")} className="sketcher-info-panel">
          <Form layout="vertical" className="sketcher-compact-form">
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
            <Form.Item label={t("ui.moleculeTags")}>
              <Select
                mode="tags"
                value={tags}
                onChange={setTags}
                options={Object.entries(additiveFunctionLabelKeys).map(([value, key]) => ({ value, label: t(key) }))}
                placeholder={t("ui.antiwearEsterSulfurContaining")}
              />
            </Form.Item>
          </Form>
          <Descriptions bordered size="small" column={2} className="sketcher-summary">
            <Descriptions.Item label={t("ui.canonicalSmiles")} span={2}><span className="mono">{canonicalSmiles || "-"}</span></Descriptions.Item>
            <Descriptions.Item label={t("ui.molecularFormula")}>{metadata?.formula || "-"}</Descriptions.Item>
            <Descriptions.Item label={t("ui.molecularWeight")}>{metadata?.molecularWeight || "-"}</Descriptions.Item>
            <Descriptions.Item label="InChIKey" span={2}><span className="mono">{metadata?.inchiKey || "-"}</span></Descriptions.Item>
            <Descriptions.Item label={t("ui.descriptorStatus")}>
              <Tag color={descriptorResult?.valid ? "green" : descriptorResult ? "red" : "blue"}>
                {descriptorResult?.valid
                  ? `${t("sketcher.successPrefix")}: ${descriptorResult.descriptorCount}`
                  : descriptorResult
                    ? t("ui.failed")
                    : t("ui.notCalculated")}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("ui.saveStatus")}>{t(statusKey)}</Descriptions.Item>
          </Descriptions>
          <div className="descriptor-preview">
            {visibleDescriptorPreview.map(([key, value]) => (
              <Tag key={key}>{key}: {String(value)}</Tag>
            ))}
            {descriptorPreview.length > visibleDescriptorPreview.length && (
              <Tag>+{descriptorPreview.length - visibleDescriptorPreview.length}</Tag>
            )}
          </div>
          <Space className="sketcher-actions" wrap>
            <Button loading={loadingAction === "generate"} onClick={handle(generateSmiles)}>{t("ui.generateSmiles")}</Button>
            <Button loading={loadingAction === "load"} onClick={handle(loadFromSmiles)}>{t("ui.loadFromSmiles")}</Button>
            <Button loading={loadingAction === "validate"} onClick={handle(validateMolecule)}>{t("ui.validate")}</Button>
            <Button loading={loadingAction === "descriptors"} onClick={handle(() => calculateDescriptors())}>{t("ui.calculateDescriptors")}</Button>
            <Button onClick={handle(clearCanvas)}>{t("ui.clear")}</Button>
            <Button onClick={() => exportData("smiles")}>{t("ui.exportSmiles")}</Button>
            <Button onClick={() => exportData("molfile")}>{t("ui.exportMolfile")}</Button>
            <Button onClick={() => exportData("csv")}>{t("ui.exportCsv")}</Button>
          </Space>
          <Space className="sketcher-save-actions" wrap>
            <Button type="primary" loading={loadingAction === "save"} onClick={handle(() => saveToLibrary(false))}>{t("ui.saveToMoleculeLibrary")}</Button>
            <Button loading={loadingAction === "import"} onClick={handle(importAsNewMolecule)}>{t("ui.importAsNewMolecule")}</Button>
            <Button loading={loadingAction === "save"} onClick={handle(() => saveToLibrary(true))}>{t("ui.saveAndView")}</Button>
          </Space>
          <Typography.Paragraph type="secondary" className="sketcher-source-line">
            {t("ui.source")}:{" "}
            {t(SOURCE_LABEL_KEYS[molfile ? "molfile_input" : inputSmiles ? "smiles_input" : "ketcher"])}
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}
