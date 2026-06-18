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
  ketcher: "Ketcher 绘制",
  smiles_input: "SMILES 输入",
  molfile_input: "Molfile 输入",
  library_edit: "分子库编辑"
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
  const [statusText, setStatusText] = useState("尚未保存");
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
      setStatusText("已从分子库加载，可保存更新或导入为新副本");
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
      throw new Error("SMILES 是新建分子的必填项，请先绘制分子或输入 SMILES。");
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
      if (!result.valid) throw new Error("SMILES 无效，请检查分子结构。");
      setMetadata(result);
      const canonical = result.canonicalSmiles || result.smilesCanonical || "";
      if (!canonical.trim()) throw new Error("SMILES 是新建分子的必填项，请先生成 canonical SMILES。");
      setCanonicalSmiles(canonical);
      setStatusText("Canonical SMILES 已生成");
      return result;
    });
  }

  async function loadFromSmiles() {
    await withLoading("load", async () => {
      const smiles = inputSmiles.trim();
      if (!smiles) throw new Error("SMILES 是新建分子的必填项，请先输入 SMILES。");
      const validation = await validateSketcherSmiles(smiles);
      if (!validation.valid) throw new Error("SMILES 无效，请检查分子结构。");
      const mol = await smilesToMolfile(smiles);
      await editorRef.current?.setMolecule(String(mol.molfile ?? ""), "molfile");
      setOriginalSmiles(smiles);
      setCanonicalSmiles(validation.canonicalSmiles || validation.smilesCanonical || "");
      setMolfile(String(mol.molfile ?? ""));
      setMetadata(validation);
      setStatusText("已从 SMILES 加载结构");
    });
  }

  async function validateMolecule() {
    await withLoading("validate", async () => {
      const result = await generateSmiles();
      if (!result?.valid) throw new Error("Invalid SMILES. Please check the molecular structure.");
      message.success("分子结构校验通过。");
    });
  }

  async function calculateDescriptors(allowFailure = false) {
    return withLoading("descriptors", async () => {
      const smiles = canonicalSmiles || (await generateSmiles())?.canonicalSmiles || "";
      if (!smiles) throw new Error("Invalid SMILES. Please check the molecular structure.");
      const descriptors = await calculateSketcherDescriptors(smiles);
      setDescriptorResult(descriptors);
      if (!descriptors.valid && !allowFailure) {
        throw new Error(descriptors.error || "描述符计算失败。");
      }
      setStatusText(descriptors.valid ? "描述符计算完成" : "描述符计算失败，允许仅导入基础信息");
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
      content: "新分子已写入 Molecule Library。",
      okText: "Stay Here",
      cancelText: "View in Molecule Library",
      icon: null,
      onCancel: () => navigate("/molecules")
    });
  }

  async function saveMolecule(importMode: ImportNewMoleculePayload["importMode"], forceNew = false) {
    return withLoading(forceNew ? "import" : "save", async () => {
      const validation = await generateSmiles();
      if (!validation.valid) throw new Error("SMILES 无效，请检查分子结构。");
      const canonical = validation.canonicalSmiles || validation.smilesCanonical || canonicalSmiles;
      if (!canonical.trim()) throw new Error("SMILES 是新建分子的必填项，请先生成 canonical SMILES。");
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
      if (!result.success) throw new Error(result.error || "保存失败。");
      setStatusText(forceNew ? "New molecule imported successfully." : "已保存到分子库");
      message.success(forceNew ? "New molecule imported successfully." : "已保存到 Molecule Library。");
      return result;
    });
  }

  function confirmContinueWithoutDescriptors() {
    return new Promise<void>((resolve, reject) => {
      Modal.confirm({
        title: "建议先计算描述符；是否继续保存？",
        content: "如果描述符计算失败，仍会保存基础分子信息，并将 descriptor_status 记录为 failed。",
        okText: "继续保存",
        cancelText: "取消",
        onOk: () => resolve(),
        onCancel: () => reject(new Error("已取消保存。"))
      });
    });
  }

  function confirmDuplicateImport(forceNew: boolean) {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: forceNew
          ? "This molecule may already exist in the Molecule Library. Do you still want to import it as a new molecule?"
          : "该分子可能已经存在，是否仍然保存？",
        content: forceNew ? "确认后会创建新分子副本，并记录 duplicate_of 与 import_mode = new_copy。" : "建议使用导入为新分子来创建副本，或取消后回到分子库编辑原记录。",
        okText: "继续",
        cancelText: "取消",
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
    setStatusText("尚未保存");
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
        title="分子绘画与 SMILES 生成"
        description="绘制分子、生成 canonical SMILES、计算描述符并保存。"
      />
      {errorText && <Card className="error-panel">{errorText}</Card>}
      <div className="sketcher-layout">
        <KetcherEditor ref={editorRef} loading={Boolean(loadingAction)} onChange={({ smiles, molfile }) => {
          setInputSmiles(smiles);
          setMolfile(molfile);
        }} />
        <Card title="分子信息" className="sketcher-info-panel">
          <Form layout="vertical" className="sketcher-compact-form">
            <Form.Item label="SMILES 输入" className="sketcher-form-full">
              <Input.TextArea className="mono" rows={2} value={inputSmiles} onChange={(event) => setInputSmiles(event.target.value)} />
            </Form.Item>
            <Form.Item label="分子名称">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="留空时自动生成 Molecule_[formula]" />
            </Form.Item>
            <Form.Item label="分子类别">
              <Select value={category} onChange={setCategory} options={moleculeCategories.map((value) => ({ value, label: moleculeCategoryLabels[value] }))} />
            </Form.Item>
            <Form.Item label="分子标签">
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
            <Descriptions.Item label="分子式">{metadata?.formula || "-"}</Descriptions.Item>
            <Descriptions.Item label="分子量">{metadata?.molecularWeight || "-"}</Descriptions.Item>
            <Descriptions.Item label="InChIKey" span={2}><span className="mono">{metadata?.inchiKey || "-"}</span></Descriptions.Item>
            <Descriptions.Item label="描述符状态">
              <Tag color={descriptorResult?.valid ? "green" : descriptorResult ? "red" : "blue"}>
                {descriptorResult?.valid ? `成功：${descriptorResult.descriptorCount}` : descriptorResult ? "失败" : "未计算"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="保存状态">{statusText}</Descriptions.Item>
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
            <Button loading={loadingAction === "generate"} onClick={generateSmiles}>生成 SMILES</Button>
            <Button loading={loadingAction === "load"} onClick={loadFromSmiles}>从 SMILES 加载</Button>
            <Button loading={loadingAction === "validate"} onClick={validateMolecule}>校验</Button>
            <Button loading={loadingAction === "descriptors"} onClick={() => calculateDescriptors()}>计算描述符</Button>
            <Button onClick={clearCanvas}>清空</Button>
            <Button onClick={() => exportData("smiles")}>导出 SMILES</Button>
            <Button onClick={() => exportData("molfile")}>导出 Molfile</Button>
            <Button onClick={() => exportData("csv")}>导出 CSV</Button>
          </Space>
          <Space className="sketcher-save-actions" wrap>
            <Button type="primary" loading={loadingAction === "save"} onClick={() => saveToLibrary(false)}>
              保存到分子库
            </Button>
            <Button loading={loadingAction === "import"} onClick={importAsNewMolecule}>
              导入为新分子
            </Button>
            <Button loading={loadingAction === "save"} onClick={() => saveToLibrary(true)}>
              保存并查看
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" className="sketcher-source-line">
            来源：{sourceLabels[molfile ? "molfile_input" : inputSmiles ? "smiles_input" : "ketcher"]}
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}
