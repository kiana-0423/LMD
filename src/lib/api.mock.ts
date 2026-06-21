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
import { mockSvg } from "./mockData";
import { buildMock3dMolBlock, buildMockPdbBlock, buildMockSdfBlock } from "./mockStructure";
import type {
  Additive,
  BaseOil,
  DashboardSummary,
  Experiment,
  Formulation,
  MLDescriptorMatrixOptions,
  Molecule,
  MoleculeDescriptor,
  PerformanceResult
} from "../types";

export type SaveMoleculeWithRequiredDescriptorsPayload = {
  name: string;
  aliases: string;
  smiles: string;
  category: Molecule["category"];
  dataSource: string;
  notes: string;
  additiveFunctionTags: string[];
  allowMock: boolean;
};

export type ExperimentPerformancePayload = {
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
};

export type CreateFormulationComponentPayload = {
  componentRole: "base_oil" | "additive" | "solvent" | "other";
  moleculeId?: string;
  baseOilId?: string;
  additiveId?: string;
  concentrationValue?: number;
  concentrationUnit?: string;
  notes?: string;
};

export type CreateFormulationPayload = {
  name: string;
  components: CreateFormulationComponentPayload[];
  preparationMethod?: string;
  preparationTemperature?: number;
  preparationTemperatureUnit?: string;
  preparationTime?: number;
  preparationTimeUnit?: string;
  stabilityObservation?: string;
  notes?: string;
};

export type CreateBaseOilPayload = {
  name: string;
  baseOilType?: string;
  representativeMoleculeId?: string;
  viscosity40c?: number;
  viscosity100c?: number;
  viscosityIndex?: number;
  density?: number;
  pourPoint?: number;
  flashPoint?: number;
  supplier?: string;
  batchNumber?: string;
  notes?: string;
};

export type CreateAdditivePayload = {
  moleculeId: string;
  functionTypes?: string[];
  activeElements?: string[];
  typicalConcentrationMin?: number;
  typicalConcentrationMax?: number;
  concentrationUnit?: string;
  compatibleBaseOils?: string[];
  applicationNotes?: string;
};

export async function mockGetDashboardSummary(): Promise<DashboardSummary> {
  return dashboardSummary;
}

export async function mockListMolecules(): Promise<Molecule[]> {
  return molecules;
}

export async function mockGetMolecule(id: string): Promise<Molecule | undefined> {
  return molecules.find((item) => item.id === id);
}

export async function mockGenerateMolecule3d(smiles: string) {
  const molBlock = buildMock3dMolBlock(smiles);
  return {
    mode: "mock",
    mol_block: molBlock,
    sdf_block: buildMockSdfBlock(molBlock),
    pdb_block: buildMockPdbBlock(smiles)
  };
}

export async function mockDeleteMolecule(id: string) {
  const deleted = removeById(molecules, id);
  removeWhere(moleculeDescriptors, (item) => item.moleculeId === id);
  updateDashboardCounts();
  return { success: deleted, deleted };
}

export async function mockListMoleculeDescriptors(moleculeId?: string): Promise<MoleculeDescriptor[]> {
  return moleculeId ? moleculeDescriptors.filter((item) => item.moleculeId === moleculeId) : moleculeDescriptors;
}

export async function mockSaveMoleculeWithRequiredDescriptors(
  payload: SaveMoleculeWithRequiredDescriptorsPayload
): Promise<Molecule> {
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
  updateDashboardCounts();
  return molecule;
}

export async function mockListBaseOils(): Promise<BaseOil[]> {
  return baseOils;
}

export async function mockCreateBaseOil(payload: CreateBaseOilPayload): Promise<BaseOil> {
  await delay(150);
  const createdAt = new Date().toISOString();
  const baseOil: BaseOil = {
    id: `bo-${Date.now()}`,
    name: payload.name.trim(),
    baseOilType: payload.baseOilType ?? "",
    representativeMoleculeId: payload.representativeMoleculeId,
    viscosity40c: payload.viscosity40c,
    viscosity100c: payload.viscosity100c,
    viscosityIndex: payload.viscosityIndex,
    density: payload.density,
    pourPoint: payload.pourPoint,
    flashPoint: payload.flashPoint,
    supplier: payload.supplier ?? "",
    batchNumber: payload.batchNumber ?? "",
    formulationCount: 0,
    notes: payload.notes ?? "",
    createdAt,
    updatedAt: createdAt
  };
  baseOils.unshift(baseOil);
  updateDashboardCounts();
  return baseOil;
}

export async function mockDeleteBaseOil(id: string) {
  const deleted = removeById(baseOils, id);
  updateDashboardCounts();
  return { success: deleted, deleted };
}

export async function mockListAdditives(): Promise<Additive[]> {
  return additives;
}

export async function mockCreateAdditive(payload: CreateAdditivePayload): Promise<Additive> {
  await delay(150);
  const molecule = molecules.find((item) => item.id === payload.moleculeId);
  if (!molecule) {
    throw new Error(`未找到代表分子：${payload.moleculeId}`);
  }
  const createdAt = new Date().toISOString();
  const additive: Additive = {
    id: `add-${Date.now()}`,
    moleculeId: payload.moleculeId,
    moleculeName: molecule.name,
    functionTypes: payload.functionTypes ?? [],
    activeElements: payload.activeElements ?? [],
    typicalConcentrationMin: payload.typicalConcentrationMin ?? 0,
    typicalConcentrationMax: payload.typicalConcentrationMax ?? 0,
    concentrationUnit: payload.concentrationUnit ?? "wt%",
    compatibleBaseOils: payload.compatibleBaseOils ?? [],
    formulationCount: 0,
    applicationNotes: payload.applicationNotes ?? "",
    createdAt,
    updatedAt: createdAt
  };
  additives.unshift(additive);
  updateDashboardCounts();
  return additive;
}

export async function mockDeleteAdditive(id: string) {
  const deleted = removeById(additives, id);
  updateDashboardCounts();
  return { success: deleted, deleted };
}

export async function mockListFormulations(): Promise<Formulation[]> {
  return formulations;
}

export async function mockCreateFormulation(payload: CreateFormulationPayload): Promise<Formulation> {
  await delay(200);
  const createdAt = new Date().toISOString();
  const id = `frm-${Date.now()}`;
  const components = payload.components.map((component, index) => ({
    id: `${id}-component-${index + 1}`,
    formulationId: id,
    componentRole: component.componentRole,
    moleculeId: component.moleculeId,
    baseOilId: component.baseOilId,
    additiveId: component.additiveId,
    concentrationValue: component.concentrationValue ?? 0,
    concentrationUnit: component.concentrationUnit ?? "wt%",
    notes: component.notes ?? ""
  }));
  const baseOilComponent = components.find((component) => component.componentRole === "base_oil");
  const baseOil = baseOils.find((item) => item.id === baseOilComponent?.baseOilId);
  const additiveCount = components.filter((component) => component.componentRole === "additive").length;
  const formulation: Formulation = {
    id,
    name: payload.name.trim(),
    baseOil: baseOil?.name ?? "",
    additiveCount,
    components,
    componentsSummary: buildFormulationComponentSummary(components),
    preparationMethod: payload.preparationMethod ?? "",
    preparationTemperature: payload.preparationTemperature,
    preparationTemperatureUnit: payload.preparationTemperatureUnit ?? "C",
    preparationTime: payload.preparationTime,
    preparationTimeUnit: payload.preparationTimeUnit ?? "min",
    stabilityObservation: payload.stabilityObservation ?? "",
    experimentCount: 0,
    notes: payload.notes ?? "",
    createdAt,
    updatedAt: createdAt
  };
  formulations.unshift(formulation);
  if (baseOil) baseOil.formulationCount += 1;
  components.forEach((component) => {
    const additive = additives.find((item) => item.id === component.additiveId);
    if (additive) additive.formulationCount += 1;
  });
  updateDashboardCounts();
  return formulation;
}

export async function mockDeleteFormulation(id: string) {
  const deleted = removeById(formulations, id);
  const experimentIds = experiments.filter((item) => item.formulationId === id).map((item) => item.id);
  removeWhere(experiments, (item) => item.formulationId === id);
  removeWhere(performanceResults, (item) => experimentIds.includes(item.experimentId));
  updateDashboardCounts();
  return { success: deleted, deleted };
}

export async function mockListExperiments(): Promise<Experiment[]> {
  return experiments;
}

export async function mockListPerformanceResults(): Promise<PerformanceResult[]> {
  return performanceResults;
}

export async function mockSaveExperimentWithPerformance(payload: ExperimentPerformancePayload) {
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
  if (formulation) updateFormulationPerformanceSummary(formulation);
  updateDashboardCounts();
  return { experiment, result };
}

export async function mockDeleteExperimentRecord(experimentId: string) {
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

export async function mockUpdateExperimentRecord(experimentId: string, payload: Partial<ExperimentPerformancePayload>) {
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

export async function mockExportAllDescriptorsCsv() {
  return buildAllDescriptorCsv(molecules, moleculeDescriptors);
}

export async function mockExportMlDescriptorMatrixCsv(options: MLDescriptorMatrixOptions) {
  return buildMlDescriptorMatrixCsv(molecules, moleculeDescriptors, options);
}

export async function mockImportExcelWithSidecar(filePath: string) {
  return {
    preview_rows: [],
    imported_count: 0,
    file_path: filePath
  };
}

export async function mockRecalculateAllDescriptors() {
  await delay(500);
  molecules.forEach((molecule) => {
    molecule.rdkitDescriptorStatus = "mock";
    molecule.mordredDescriptorStatus = "mock";
    molecule.descriptorReady = true;
  });
  updateDashboardCounts();
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

function buildFormulationComponentSummary(components: Formulation["components"] = []) {
  return components
    .map((component) => {
      const baseOil = baseOils.find((item) => item.id === component.baseOilId);
      const additive = additives.find((item) => item.id === component.additiveId);
      const molecule = molecules.find((item) => item.id === component.moleculeId);
      const name = baseOil?.name ?? additive?.moleculeName ?? molecule?.name ?? component.componentRole;
      const concentration = Number.isFinite(component.concentrationValue) ? ` ${component.concentrationValue}` : "";
      const unit = component.concentrationUnit ? ` ${component.concentrationUnit}` : "";
      return `${name}${concentration}${unit}`;
    })
    .join(" + ");
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
