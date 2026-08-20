import { Button, Card, Descriptions, Form, Input, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { getMolecule } from "../../lib/api";
import { additiveFunctionLabels, moleculeCategories, moleculeCategoryLabels } from "../../lib/constants";
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

const sourceLabels: Record<string, string> = {
  ketcher: "Ketcher Drawing",
  smiles_input: "SMILES Input",
  molfile_input: "Molfile Input",
  library_edit: "Molecule Library Edit"
};

export default function MoleculeSketcherPage() {
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
  const [statusText, setStatusText] = useState("Not saved");
  const [errorText, setErrorText] = useState("");
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
      setStatusText("Loaded from the molecule library; save changes or import as a new copy");
    });
  }, [searchParams]);

  const descriptorPreview = useMemo(
    () => Object.entries(descriptorResult?.preview ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ""),
    [descriptorResult]
  );
  const visibleDescriptorPreview = descriptorPreview.slice(0, 4);

  async function withLoading<T>(action: string, task: () => Promise<T>) {
    setLoadingAction(action);
    setErrorText("");
    try {
      return await task();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setErrorText(text);
      throw error;
    } finally {
      setLoadingAction(undefined);
    }
  }

  async function readStructureOrFail() {
    const editorSmiles = (await editorRef.current?.getSmiles()) || "";
    const smiles = (editorSmiles || canonicalSmiles || inputSmiles).trim();
    const currentMolfile = ((await editorRef.current?.getMolfile()) || molfile).trim();
    if (!smiles && !currentMolfile) {
      throw new Error("SMILES is required for a new molecule. Draw a molecule or enter SMILES first.");
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
      if (!result.valid) throw new Error("Invalid SMILES. Check the molecular structure.");
      setMetadata(result);
      const canonical = result.canonicalSmiles || result.smilesCanonical || "";
      if (!canonical.trim()) throw new Error("SMILES is required for a new molecule. Generate canonical SMILES first.");
      setCanonicalSmiles(canonical);
      setStatusText("Canonical SMILES generated");
      return result;
    });
  }

  async function loadFromSmiles() {
    await withLoading("load", async () => {
      const smiles = inputSmiles.trim();
      if (!smiles) throw new Error("SMILES is required for a new molecule. Enter SMILES first.");
      const validation = await validateSketcherSmiles(smiles);
      if (!validation.valid) throw new Error("Invalid SMILES. Check the molecular structure.");
      const mol = await smilesToMolfile(smiles);
      await editorRef.current?.setMolecule(String(mol.molfile ?? ""), "molfile");
      setOriginalSmiles(smiles);
      setCanonicalSmiles(validation.canonicalSmiles || validation.smilesCanonical || "");
      setMolfile(String(mol.molfile ?? ""));
      setMetadata(validation);
      setStatusText("Structure loaded from SMILES");
    });
  }

  async function validateMolecule() {
    await withLoading("validate", async () => {
      const result = await generateSmiles();
      if (!result?.valid) throw new Error("Invalid SMILES. Please check the molecular structure.");
      message.success("Molecular structure validated.");
    });
  }

  async function calculateDescriptors(allowFailure = false) {
    return withLoading("descriptors", async () => {
      const smiles = canonicalSmiles || (await generateSmiles())?.canonicalSmiles || "";
      if (!smiles) throw new Error("Invalid SMILES. Please check the molecular structure.");
      const descriptors = await calculateSketcherDescriptors(smiles);
      setDescriptorResult(descriptors);
      if (!descriptors.valid && !allowFailure) {
        throw new Error(descriptors.error || "Descriptor calculation failed.");
      }
      setStatusText(descriptors.valid ? "Descriptor calculation complete" : "Descriptor calculation failed; basic information can still be imported");
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
      title: "New molecule imported successfully.",
      content: "The new molecule was added to the Molecule Library.",
      okText: "Stay Here",
      cancelText: "View in Molecule Library",
      icon: null,
      onCancel: () => navigate("/molecules")
    });
  }

  async function saveMolecule(importMode: ImportNewMoleculePayload["importMode"], forceNew = false) {
    return withLoading(forceNew ? "import" : "save", async () => {
      const validation = await generateSmiles();
      if (!validation.valid) throw new Error("Invalid SMILES. Check the molecular structure.");
      const canonical = validation.canonicalSmiles || validation.smilesCanonical || canonicalSmiles;
      if (!canonical.trim()) throw new Error("SMILES is required for a new molecule. Generate canonical SMILES first.");
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
      if (!result.success) throw new Error(result.error || "Save failed.");
      setStatusText(forceNew ? "New molecule imported successfully." : "Saved to the molecule library");
      message.success(forceNew ? "New molecule imported successfully." : "Saved to the Molecule Library.");
      return result;
    });
  }

  function confirmContinueWithoutDescriptors() {
    return new Promise<void>((resolve, reject) => {
      Modal.confirm({
        title: "Calculate descriptors before saving?",
        content: "If descriptor calculation fails, the basic molecule information will still be saved with descriptor_status set to failed.",
        okText: "Continue Saving",
        cancelText: "Cancel",
        onOk: () => resolve(),
        onCancel: () => reject(new Error("Save cancelled."))
      });
    });
  }

  function confirmDuplicateImport(forceNew: boolean) {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: forceNew
          ? "This molecule may already exist in the Molecule Library. Do you still want to import it as a new molecule?"
          : "This molecule may already exist. Save it anyway?",
        content: forceNew ? "A new molecule copy will be created with duplicate_of and import_mode = new_copy." : "Import it as a new molecule to create a copy, or cancel and edit the original record in the library.",
        okText: "Continue",
        cancelText: "Cancel",
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
    setStatusText("Not saved");
    setErrorText("");
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
        title="Molecule Drawing and SMILES Generation"
        description="Draw molecules, generate canonical SMILES, calculate descriptors, and save records."
      />
      {errorText && <Card className="error-panel">{errorText}</Card>}
      <div className="sketcher-layout">
        <KetcherEditor ref={editorRef} loading={Boolean(loadingAction)} onChange={({ smiles, molfile }) => {
          setInputSmiles(smiles);
          setMolfile(molfile);
        }} />
        <Card title="Molecule Information" className="sketcher-info-panel">
          <Form layout="vertical" className="sketcher-compact-form">
            <Form.Item label="SMILES Input" className="sketcher-form-full">
              <Input.TextArea className="mono" rows={2} value={inputSmiles} onChange={(event) => setInputSmiles(event.target.value)} />
            </Form.Item>
            <Form.Item label="Molecule Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Leave blank to generate Molecule_[formula]" />
            </Form.Item>
            <Form.Item label="Molecule Category">
              <Select value={category} onChange={setCategory} options={moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }))} />
            </Form.Item>
            <Form.Item label="Molecule Tags">
              <Select
                mode="tags"
                value={tags}
                onChange={setTags}
                options={Object.entries(additiveFunctionLabels).map(([value, label]) => ({ value, label }))}
                placeholder="antiwear, ester, sulfur-containing..."
              />
            </Form.Item>
          </Form>
          <Descriptions bordered size="small" column={2} className="sketcher-summary">
            <Descriptions.Item label="Canonical SMILES" span={2}><span className="mono">{canonicalSmiles || "-"}</span></Descriptions.Item>
            <Descriptions.Item label="Molecular Formula">{metadata?.formula || "-"}</Descriptions.Item>
            <Descriptions.Item label="Molecular Weight">{metadata?.molecularWeight || "-"}</Descriptions.Item>
            <Descriptions.Item label="InChIKey" span={2}><span className="mono">{metadata?.inchiKey || "-"}</span></Descriptions.Item>
            <Descriptions.Item label="Descriptor Status">
              <Tag color={descriptorResult?.valid ? "green" : descriptorResult ? "red" : "blue"}>
                {descriptorResult?.valid ? `Success: ${descriptorResult.descriptorCount}` : descriptorResult ? "Failed" : "Not calculated"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Save Status">{statusText}</Descriptions.Item>
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
            <Button loading={loadingAction === "generate"} onClick={generateSmiles}>Generate SMILES</Button>
            <Button loading={loadingAction === "load"} onClick={loadFromSmiles}>Load from SMILES</Button>
            <Button loading={loadingAction === "validate"} onClick={validateMolecule}>Validate</Button>
            <Button loading={loadingAction === "descriptors"} onClick={() => calculateDescriptors()}>Calculate Descriptors</Button>
            <Button onClick={clearCanvas}>Clear</Button>
            <Button onClick={() => exportData("smiles")}>Export SMILES</Button>
            <Button onClick={() => exportData("molfile")}>Export Molfile</Button>
            <Button onClick={() => exportData("csv")}>Export CSV</Button>
          </Space>
          <Space className="sketcher-save-actions" wrap>
            <Button type="primary" loading={loadingAction === "save"} onClick={() => saveToLibrary(false)}>
              Save to Molecule Library
            </Button>
            <Button loading={loadingAction === "import"} onClick={importAsNewMolecule}>
              Import as New Molecule
            </Button>
            <Button loading={loadingAction === "save"} onClick={() => saveToLibrary(true)}>
              Save and View
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" className="sketcher-source-line">
            Source: {sourceLabels[molfile ? "molfile_input" : inputSmiles ? "smiles_input" : "ketcher"]}
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}
