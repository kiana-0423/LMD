import {
  additives,
  baseOils,
  dashboardSummary,
  experiments,
  formulations,
  moleculeDescriptors,
  molecules,
  performanceResults
} from "./mockData";
import type { Additive, BaseOil, DashboardSummary, Experiment, Formulation, MLDescriptorMatrixOptions, Molecule, MoleculeDescriptor, PerformanceResult } from "../types";
import { buildMock3dMolBlock, buildMockPdbBlock, buildMockSdfBlock } from "./mockStructure";
import { mockSvg } from "./mockData";
import { invokeOrMock } from "./tauri";

export async function getDashboardSummary() {
  return invokeOrMock<DashboardSummary>("get_dashboard_summary", {}, async () => dashboardSummary);
}

export async function listMolecules() {
  return invokeOrMock<Molecule[]>("list_molecules", { filter: null }, async () => molecules);
}

export async function getMolecule(id: string) {
  return invokeOrMock<Molecule | undefined>("get_molecule", { id }, async () =>
    molecules.find((item) => item.id === id)
  );
}

export async function generateMolecule3d(smiles: string) {
  return invokeOrMock<{ data?: Record<string, string>; mol_block?: string; sdf_block?: string; pdb_block?: string; mode?: string }>(
    "generate_molecule_3d",
    { smiles },
    async () => {
      const molBlock = buildMock3dMolBlock(smiles);
      return {
        mode: "mock",
        mol_block: molBlock,
        sdf_block: buildMockSdfBlock(molBlock),
        pdb_block: buildMockPdbBlock(smiles)
      };
    }
  ).then((value) => value.data ?? value);
}

export async function deleteMolecule(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_molecule", { id }, async () => {
    const deleted = removeById(molecules, id);
    removeWhere(moleculeDescriptors, (item) => item.moleculeId === id);
    updateDashboardCounts();
    return { success: deleted, deleted };
  });
}

export async function listMoleculeDescriptors(moleculeId?: string) {
  return invokeOrMock<MoleculeDescriptor[]>(
    "list_molecule_descriptors",
    { moleculeId: moleculeId ?? null },
    async () => (moleculeId ? moleculeDescriptors.filter((item) => item.moleculeId === moleculeId) : moleculeDescriptors)
  );
}

export async function saveMoleculeWithRequiredDescriptors(payload: {
  name: string;
  aliases: string;
  smiles: string;
  category: Molecule["category"];
  dataSource: string;
  notes: string;
  additiveFunctionTags: string[];
  allowMock: boolean;
}) {
  return invokeOrMock<Molecule>("save_molecule_with_required_descriptors", { payload }, async () =>
    saveMoleculeWithRequiredDescriptorsMock(payload)
  );
}

async function saveMoleculeWithRequiredDescriptorsMock(payload: {
  name: string;
  aliases: string;
  smiles: string;
  category: Molecule["category"];
  dataSource: string;
  notes: string;
  additiveFunctionTags: string[];
  allowMock: boolean;
}) {
  await delay(450);
  const id = `mol-${Date.now()}`;
  const molBlock = buildMock3dMolBlock(payload.smiles, payload.name || payload.smiles);
  const molecule: Molecule = {
    id,
    name: payload.name || "新分子",
    aliases: payload.aliases,
    smilesRaw: payload.smiles,
    smilesCanonical: payload.smiles.trim(),
    inchi: `mock:InChI:${payload.smiles.trim()}`,
    inchiKey: `MOCK-${Date.now()}`,
    formula: estimateFormula(payload.smiles),
    molecularWeight: estimateMolWeight(payload.smiles),
    category: payload.category,
    additiveFunctionTags: payload.additiveFunctionTags,
    structureSvgPath: `files/structures/${id}.svg`,
    structureSvg: mockSvg(payload.name || payload.smiles),
    molFilePath: `files/structures/${id}.mol`,
    sdfFilePath: `files/structures/${id}.sdf`,
    pdbFilePath: `files/structures/${id}.pdb`,
    molBlock,
    sdfBlock: buildMockSdfBlock(molBlock),
    pdbBlock: buildMockPdbBlock(payload.smiles, payload.name || "MOCK MOLECULE"),
    rdkitDescriptorStatus: "mock",
    mordredDescriptorStatus: payload.allowMock ? "mock" : "calculated",
    descriptorReady: true,
    sourceId: "manual",
    dataSource: payload.dataSource,
    notes: payload.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  molecules.unshift(molecule);
  moleculeDescriptors.push(createDescriptor(molecule, "rdkit"), createDescriptor(molecule, "mordred"));
  return molecule;
}

export async function listBaseOils() {
  return invokeOrMock<BaseOil[]>("list_base_oils", { filter: null }, async () => []);
}

export async function deleteBaseOil(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_base_oil", { id }, async () => {
    const deleted = removeById(baseOils, id);
    updateDashboardCounts();
    return { success: deleted, deleted };
  });
}

export async function listAdditives() {
  return invokeOrMock<Additive[]>("list_additives", { filter: null }, async () => []);
}

export async function deleteAdditive(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_additive", { id }, async () => {
    const deleted = removeById(additives, id);
    updateDashboardCounts();
    return { success: deleted, deleted };
  });
}

export async function listFormulations() {
  return invokeOrMock<Formulation[]>("list_formulations", { filter: null }, async () => []);
}

export async function deleteFormulation(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_formulation", { id }, async () => {
    const deleted = removeById(formulations, id);
    const experimentIds = experiments.filter((item) => item.formulationId === id).map((item) => item.id);
    removeWhere(experiments, (item) => item.formulationId === id);
    removeWhere(performanceResults, (item) => experimentIds.includes(item.experimentId));
    updateDashboardCounts();
    return { success: deleted, deleted };
  });
}

export async function listExperiments() {
  return invokeOrMock<Experiment[]>("list_experiments", { filter: null }, async () => experiments);
}

export async function listPerformanceResults() {
  return invokeOrMock<PerformanceResult[]>("list_performance_results", { filter: null }, async () => performanceResults);
}

export async function saveExperimentWithPerformance(payload: {
  formulationId: string;
  testType: string;
  testStandard?: string;
  instrument?: string;
  upperMaterial?: string;
  lowerMaterial?: string;
  loadValue?: number;
  temperatureValue?: number;
  durationValue?: number;
  averageFrictionCoefficient?: number;
  stableFrictionCoefficient?: number;
  wearScarDiameterValue?: number;
  initialOxidationTemperatureValue?: number;
  extremePressureValue?: number;
}) {
  await delay(200);
  const formulation = formulations.find((item) => item.id === payload.formulationId);
  const createdAt = new Date().toISOString();
  const experiment: Experiment = {
    id: `exp-${Date.now()}`,
    formulationId: payload.formulationId,
    formulationName: formulation?.name ?? payload.formulationId,
    testType: payload.testType || "未指定",
    testStandard: payload.testStandard ?? "",
    instrument: payload.instrument ?? "",
    upperMaterial: payload.upperMaterial ?? "",
    lowerMaterial: payload.lowerMaterial ?? "",
    loadValue: payload.loadValue,
    loadUnit: "N",
    temperatureValue: payload.temperatureValue,
    temperatureUnit: "C",
    durationValue: payload.durationValue,
    durationUnit: "min",
    operator: "当前用户",
    experimentDate: createdAt.slice(0, 10),
    notes: "由实验与性能页面录入。",
    createdAt,
    updatedAt: createdAt
  };
  const result: PerformanceResult = {
    id: `perf-${Date.now()}`,
    experimentId: experiment.id,
    averageFrictionCoefficient: payload.averageFrictionCoefficient,
    stableFrictionCoefficient: payload.stableFrictionCoefficient,
    wearScarDiameterValue: payload.wearScarDiameterValue,
    initialOxidationTemperatureValue: payload.initialOxidationTemperatureValue,
    extremePressureValue: payload.extremePressureValue,
    repeatCount: 1,
    notes: "由实验与性能页面录入。",
    createdAt,
    updatedAt: createdAt
  };
  experiments.unshift(experiment);
  performanceResults.unshift(result);
  if (formulation) {
    updateFormulationPerformanceSummary(formulation);
  }
  return { experiment, result };
}

export async function deleteExperimentRecord(experimentId: string) {
  const experiment = experiments.find((item) => item.id === experimentId);
  const experimentIndex = experiments.findIndex((item) => item.id === experimentId);
  if (experimentIndex >= 0) experiments.splice(experimentIndex, 1);
  for (let index = performanceResults.length - 1; index >= 0; index -= 1) {
    if (performanceResults[index].experimentId === experimentId) {
      performanceResults.splice(index, 1);
    }
  }
  const formulation = formulations.find((item) => item.id === experiment?.formulationId);
  if (formulation) updateFormulationPerformanceSummary(formulation);
  updateDashboardCounts();
  return { success: experimentIndex >= 0 };
}

export async function updateExperimentRecord(
  experimentId: string,
  payload: {
    testType?: string;
    testStandard?: string;
    instrument?: string;
    upperMaterial?: string;
    lowerMaterial?: string;
    loadValue?: number;
    temperatureValue?: number;
    durationValue?: number;
    averageFrictionCoefficient?: number;
    stableFrictionCoefficient?: number;
    wearScarDiameterValue?: number;
    initialOxidationTemperatureValue?: number;
    extremePressureValue?: number;
  }
) {
  const experiment = experiments.find((item) => item.id === experimentId);
  if (!experiment) return { success: false };
  const updatedAt = new Date().toISOString();
  experiment.testType = payload.testType ?? experiment.testType;
  experiment.testStandard = payload.testStandard ?? "";
  experiment.instrument = payload.instrument ?? "";
  experiment.upperMaterial = payload.upperMaterial ?? "";
  experiment.lowerMaterial = payload.lowerMaterial ?? "";
  experiment.loadValue = payload.loadValue;
  experiment.temperatureValue = payload.temperatureValue;
  experiment.durationValue = payload.durationValue;
  experiment.updatedAt = updatedAt;

  let result = performanceResults.find((item) => item.experimentId === experimentId);
  if (!result) {
    result = {
      id: `perf-${Date.now()}`,
      experimentId,
      repeatCount: 1,
      notes: "由实验数据修正生成。",
      createdAt: updatedAt,
      updatedAt
    };
    performanceResults.unshift(result);
  }
  result.averageFrictionCoefficient = payload.averageFrictionCoefficient;
  result.stableFrictionCoefficient = payload.stableFrictionCoefficient;
  result.wearScarDiameterValue = payload.wearScarDiameterValue;
  result.initialOxidationTemperatureValue = payload.initialOxidationTemperatureValue;
  result.extremePressureValue = payload.extremePressureValue;
  result.updatedAt = updatedAt;
  const formulation = formulations.find((item) => item.id === experiment.formulationId);
  if (formulation) updateFormulationPerformanceSummary(formulation);
  return { success: true, experiment, result };
}

export async function exportAllDescriptorsCsv() {
  return buildAllDescriptorCsv(molecules, moleculeDescriptors);
}

export async function exportMlDescriptorMatrixCsv(options: MLDescriptorMatrixOptions) {
  return buildMlDescriptorMatrixCsv(molecules, moleculeDescriptors, options);
}

export async function exportMoleculeLibraryCsv() {
  const allMolecules = await listMolecules();
  const headers = [
    "id",
    "name",
    "aliases",
    "smiles_raw",
    "smiles_canonical",
    "inchi",
    "inchi_key",
    "formula",
    "molecular_weight",
    "category",
    "additive_function_tags",
    "data_source",
    "notes",
    "created_at",
    "updated_at"
  ];
  const rows = allMolecules.map((molecule) => [
    molecule.id,
    molecule.name,
    molecule.aliases,
    molecule.smilesRaw,
    molecule.smilesCanonical,
    molecule.inchi,
    molecule.inchiKey,
    molecule.formula,
    molecule.molecularWeight,
    molecule.category,
    molecule.additiveFunctionTags.join(";"),
    molecule.dataSource,
    molecule.notes,
    molecule.createdAt,
    molecule.updatedAt
  ]);
  return toCsv([headers, ...rows]);
}

export async function importExcelWithSidecar(filePath: string) {
  return invokeOrMock<Record<string, unknown>>("import_excel_with_sidecar", { filePath }, async () => ({
    preview_rows: [],
    imported_count: 0,
    file_path: filePath
  })).then((value) => {
    const data = value.data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : value;
  });
}

export async function recalculateAllDescriptors() {
  await delay(500);
  molecules.forEach((molecule) => {
    molecule.rdkitDescriptorStatus = "mock";
    molecule.mordredDescriptorStatus = "mock";
    molecule.descriptorReady = true;
  });
  return molecules;
}

function createDescriptor(molecule: Molecule, descriptorSet: "rdkit" | "mordred"): MoleculeDescriptor {
  const descriptorsJson =
    descriptorSet === "rdkit"
      ? { MolWt: molecule.molecularWeight, MolLogP: 1.2, TPSA: 20.23, NumHDonors: 1, NumHAcceptors: 1 }
      : { ABC: 12.1, ABCGG: 11.8, nAtom: 9, mordred_mock_required: true };
  return {
    id: `${molecule.id}-${descriptorSet}`,
    moleculeId: molecule.id,
    descriptorSet,
    descriptorVersion: descriptorSet === "rdkit" ? "2026.mock" : "1.2.0-mock",
    descriptorsJson,
    descriptorCount: Object.keys(descriptorsJson).length,
    status: "mock",
    mode: "mock",
    errorMessage: "",
    calculatedAt: new Date().toISOString()
  };
}

function buildAllDescriptorCsv(allMolecules: Molecule[], descriptors: MoleculeDescriptor[]) {
  const descriptorKeys = Array.from(new Set(descriptors.flatMap((item) => Object.keys(item.descriptorsJson)))).sort();
  const headers = [
    "molecule_id",
    "molecule_name",
    "smiles_canonical",
    "inchi_key",
    "formula",
    "molecular_weight",
    "category",
    "descriptor_set",
    "descriptor_version",
    ...descriptorKeys
  ];
  const rows = descriptors.map((descriptor) => {
    const molecule = allMolecules.find((item) => item.id === descriptor.moleculeId);
    return headers.map((header) => {
      const base: Record<string, unknown> = {
        molecule_id: molecule?.id,
        molecule_name: molecule?.name,
        smiles_canonical: molecule?.smilesCanonical,
        inchi_key: molecule?.inchiKey,
        formula: molecule?.formula,
        molecular_weight: molecule?.molecularWeight,
        category: molecule?.category,
        descriptor_set: descriptor.descriptorSet,
        descriptor_version: descriptor.descriptorVersion
      };
      return base[header] ?? descriptor.descriptorsJson[header] ?? "";
    });
  });
  return toCsv([headers, ...rows]);
}

function buildMlDescriptorMatrixCsv(
  allMolecules: Molecule[],
  descriptors: MoleculeDescriptor[],
  options: MLDescriptorMatrixOptions
) {
  const rows = allMolecules.map((molecule) => {
    const row: Record<string, unknown> = {
      molecule_id: molecule.id,
      molecule_name: molecule.name,
      smiles_canonical: molecule.smilesCanonical,
      inchi_key: molecule.inchiKey,
      formula: molecule.formula,
      molecular_weight: molecule.molecularWeight,
      category: molecule.category
    };
    descriptors
      .filter((descriptor) => descriptor.moleculeId === molecule.id)
      .filter(
        (descriptor) =>
          (descriptor.descriptorSet === "rdkit" && options.includeRdkit) ||
          (descriptor.descriptorSet === "mordred" && options.includeMordred)
      )
      .forEach((descriptor) => {
        Object.entries(descriptor.descriptorsJson).forEach(([key, value]) => {
          const column = options.descriptorPrefix ? `${descriptor.descriptorSet}_${key}` : key;
          row[column] = sanitizeValue(value, options.numericOnly, options.missingValueStrategy);
        });
      });
    return row;
  });
  const metadata = ["molecule_id", "molecule_name", "smiles_canonical", "inchi_key", "formula", "molecular_weight", "category"];
  const descriptorKeys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !metadata.includes(key))))).sort();
  const headers = [...(options.includeMetadata ? metadata : []), ...descriptorKeys];
  return toCsv([headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]);
}

function sanitizeValue(value: unknown, numericOnly: boolean, missing: MLDescriptorMatrixOptions["missingValueStrategy"]) {
  const blank = missing === "zero" ? 0 : missing === "null" ? "null" : "";
  if (value === null || value === undefined) return blank;
  if (typeof value === "number") return Number.isFinite(value) ? value : blank;
  return numericOnly ? blank : String(value);
}

function updateFormulationPerformanceSummary(formulation: Formulation) {
  const formulationExperiments = experiments.filter((item) => item.formulationId === formulation.id);
  const formulationResults = formulationExperiments
    .map((experiment) => performanceResults.find((result) => result.experimentId === experiment.id))
    .filter(Boolean) as PerformanceResult[];
  formulation.experimentCount = formulationExperiments.length;
  formulation.bestAverageFrictionCoefficient = minDefined(
    formulationResults.map((result) => result.averageFrictionCoefficient)
  );
  formulation.bestWearScarDiameter = minDefined(
    formulationResults.map((result) => result.wearScarDiameterValue)
  );
  formulation.highestOxidationTemperature = maxDefined(
    formulationResults.map((result) => result.initialOxidationTemperatureValue)
  );
  formulation.updatedAt = new Date().toISOString();
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}

function removeWhere<T>(items: T[], predicate: (item: T) => boolean) {
  let removed = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      items.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

function updateDashboardCounts() {
  dashboardSummary.moleculeCount = molecules.length;
  dashboardSummary.baseOilCount = baseOils.length;
  dashboardSummary.additiveCount = additives.length;
  dashboardSummary.formulationCount = formulations.length;
  dashboardSummary.experimentCount = experiments.length;
  dashboardSummary.descriptorReadyCount = molecules.filter((item) => item.descriptorReady).length;
  dashboardSummary.descriptorFailedCount = molecules.filter((item) => item.mordredDescriptorStatus === "failed").length;
}

function minDefined(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length ? Math.min(...numbers) : undefined;
}

function maxDefined(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length ? Math.max(...numbers) : undefined;
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function estimateFormula(smiles: string) {
  const c = (smiles.match(/C/g) || []).length || 1;
  const o = (smiles.match(/O/g) || []).length;
  const n = (smiles.match(/N/g) || []).length;
  return `C${c}H${Math.max(c * 2, 2)}${o ? `O${o}` : ""}${n ? `N${n}` : ""}`;
}

function estimateMolWeight(smiles: string) {
  return Number((smiles.length * 7.1 + 18).toFixed(3));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
