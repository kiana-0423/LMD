/**
 * The browser demo, behind one door.
 *
 * Nothing outside this folder imports a mock module. Every fabricated record the demo shows comes
 * through `dispatchDemoCommand`, which is reached only from the guarded dynamic import in
 * `lib/tauri.ts` — so a build without `VITE_DEMO_MODE=true` never pulls this file, or anything it
 * imports, into the bundle.
 *
 * The table is keyed by the same command names the Rust side registers. That is deliberate: a
 * demo answer and a real answer are the same question asked of different backends, and keeping the
 * key identical is what makes the two paths comparable.
 */

import type { AnalysisResult } from "../api/analysis";
import {
  mockCompareFormulations,
  mockCreateAdditive,
  mockCreateBaseOil,
  mockCreateFormulation,
  mockCopyFormulation,
  mockDeleteAdditive,
  mockDeleteBaseOil,
  mockDeleteExperimentRecord,
  mockDeleteFormulation,
  mockDeleteMolecule,
  mockDeletePerformanceResult,
  mockExportAllDescriptorsCsv,
  mockExportMlDescriptorMatrixCsv,
  mockGenerateMolecule3d,
  mockGetDashboardSummary,
  mockGetMolecule,
  mockImportExcelWithSidecar,
  mockListAdditives,
  mockListBaseOils,
  mockListExperiments,
  mockListFormulations,
  mockListMolecules,
  mockListMoleculeDescriptors,
  mockListPerformanceResults,
  mockRecalculateAllDescriptors,
  mockSaveExperimentWithPerformance,
  mockSaveMoleculeWithRequiredDescriptors,
  mockUpdateAdditive,
  mockUpdateBaseOil,
  mockUpdateExperimentRecord,
  mockUpdateFormulation,
  mockUpdatePerformanceResult
} from "./api.mock";
import { mockSvg, moleculeDescriptors, molecules } from "./mockData";
import { buildMock3dMolBlock, buildMockPdbBlock, buildMockSdfBlock } from "./mockStructure";
import { buildMoleculeLibraryCsv } from "./csv";
import type { Molecule, MoleculeListFilter } from "../../types";
import { coded } from "../backendErrors";

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown | Promise<unknown>;

const record = (args: Args, key: string) => (args[key] ?? {}) as Record<string, unknown>;
const text = (args: Args, key: string) => String(args[key] ?? "");

/**
 * Analysis reads stored measurements, and the demo has no workspace to read.
 *
 * It reports "not enough data" rather than drawing a chart of numbers nobody measured. A demo
 * chart of invented friction coefficients is exactly the kind of thing that gets screenshotted
 * into a report.
 */
function insufficientData<T>(field: string): AnalysisResult<T> {
  return {
    status: "insufficient_data",
    // i18n-exempt: browser-demo mode only; the desktop application never reaches this branch.
    message: { detail: "Analysis requires the desktop application and a workspace database." },
    metadata: {
      recordCount: 0,
      excludedCount: 0,
      // i18n-exempt: as above.
      missingValueMessage: { detail: "not applicable in browser demo mode" },
      field,
      label: field,
      unit: "",
      // i18n-exempt: as above.
      methodMessage: { detail: "unavailable outside the desktop application" }
    },
    series: []
  };
}

/** Filters and pages the demo molecule list the way `list_molecules` does. */
async function moleculePage(filter: MoleculeListFilter) {
  const all = await mockListMolecules();
  const search = filter.search?.trim().toLowerCase() ?? "";
  const filtered = all.filter((item) => {
    const searchMatch =
      !search ||
      item.name.toLowerCase().includes(search) ||
      item.smilesCanonical.toLowerCase().includes(search) ||
      item.inchiKey.toLowerCase().includes(search);
    const categoryMatch = !filter.category || item.category === filter.category;
    const sourceMatch =
      !filter.source || item.source === filter.source || item.dataSource === filter.source;
    const importModeMatch = !filter.importMode || item.importMode === filter.importMode;
    const elementMatch = !filter.element || item.formula.includes(filter.element);
    const duplicateMatch =
      !filter.duplicateStatus ||
      (filter.duplicateStatus === "duplicate" ? Boolean(item.duplicateOf) : !item.duplicateOf);
    return searchMatch && categoryMatch && sourceMatch && importModeMatch && duplicateMatch && elementMatch;
  });
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize };
}

/** Turns a full list into the paged envelope the paginated commands return. */
function paginate<T>(items: T[], args: Args) {
  const request = record(args, "request");
  const page = Math.max(1, Number(request.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(request.pageSize ?? 50)));
  const search = String(request.search ?? "").trim().toLowerCase();
  const matched = search
    ? items.filter((item) => JSON.stringify(item).toLowerCase().includes(search))
    : items;
  const start = (page - 1) * pageSize;
  const slice = matched.slice(start, start + pageSize);
  return { items: slice, total: matched.length, page, pageSize, hasMore: start + slice.length < matched.length };
}

/** A demo delete never blocks: the demo has no referential graph worth defending. */
const demoDeletion = (id: string) => ({
  id,
  deleted: true,
  success: true,
  blocked: false,
  blockedBy: [],
  removedComponents: 0
});

const HANDLERS: Record<string, Handler> = {
  // --- workspace ------------------------------------------------------------------------------
  get_workspace_status: () => ({
    ok: true,
    data: {
      workspace_path: "browser-demo",
      database_path: "",
      sqlite_status: "unavailable",
      python_sidecar_status: "unavailable",
      python_sidecar_mode: null
    },
    warnings: []
  }),

  // --- molecules ------------------------------------------------------------------------------
  list_molecules: (args) => moleculePage(record(args, "filter") as MoleculeListFilter),
  get_molecule: (args) => mockGetMolecule(text(args, "id")),
  delete_molecule: (args) => mockDeleteMolecule(text(args, "id")),
  save_molecule_with_required_descriptors: (args) =>
    mockSaveMoleculeWithRequiredDescriptors(record(args, "payload") as never),
  generate_molecule_3d: (args) => mockGenerateMolecule3d(text(args, "moleculeId")),
  list_formulations_for_molecule: () => [],
  list_molecule_files: () => ({ structureFiles: [], attachments: [] }),

  // --- descriptors ----------------------------------------------------------------------------
  list_molecule_descriptors: (args) =>
    mockListMoleculeDescriptors(args.moleculeId ? text(args, "moleculeId") : undefined),
  list_descriptor_jobs: () => ({ items: [] }),
  recalculate_all_descriptors: () => mockRecalculateAllDescriptors(),
  recalculate_failed_descriptors: () => mockRecalculateAllDescriptors(),
  batch_calculate_descriptors: () => mockRecalculateAllDescriptors(),

  // --- base oils and additives ----------------------------------------------------------------
  list_base_oils: () => mockListBaseOils(),
  list_base_oils_page: async (args) => paginate(await mockListBaseOils(), args),
  search_base_oils: async () =>
    (await mockListBaseOils()).map((item) => ({ id: item.id, label: item.name, detail: item.baseOilType })),
  create_base_oil: (args) => mockCreateBaseOil(record(args, "payload") as never),
  update_base_oil: (args) => mockUpdateBaseOil(text(args, "id"), record(args, "payload") as never),
  delete_base_oil: async (args) => {
    await mockDeleteBaseOil(text(args, "id"));
    return demoDeletion(text(args, "id"));
  },
  delete_base_oil_with_components: async (args) => {
    await mockDeleteBaseOil(text(args, "id"));
    return demoDeletion(text(args, "id"));
  },
  list_additives: () => mockListAdditives(),
  list_additives_page: async (args) => paginate(await mockListAdditives(), args),
  search_additives: async () =>
    (await mockListAdditives()).map((item) => ({
      id: item.id,
      label: item.moleculeName,
      detail: item.functionTypes.join(", ")
    })),
  create_additive: (args) => mockCreateAdditive(record(args, "payload") as never),
  update_additive: (args) => mockUpdateAdditive(text(args, "id"), record(args, "payload") as never),
  delete_additive: async (args) => {
    await mockDeleteAdditive(text(args, "id"));
    return demoDeletion(text(args, "id"));
  },
  delete_additive_with_components: async (args) => {
    await mockDeleteAdditive(text(args, "id"));
    return demoDeletion(text(args, "id"));
  },

  // --- formulations ---------------------------------------------------------------------------
  list_formulations: () => mockListFormulations(),
  list_formulations_page: async (args) => paginate(await mockListFormulations(), args),
  search_formulations: async () =>
    (await mockListFormulations()).map((item) => ({
      id: item.id,
      label: item.name,
      detail: item.preparationMethod ?? ""
    })),
  create_formulation: (args) => mockCreateFormulation(record(args, "payload") as never),
  update_formulation: (args) => mockUpdateFormulation(text(args, "id"), record(args, "payload") as never),
  copy_formulation: (args) =>
    mockCopyFormulation(text(args, "id"), args.name ? text(args, "name") : undefined),
  compare_formulations: (args) => mockCompareFormulations((args.ids as string[]) ?? []),
  delete_formulation: (args) => mockDeleteFormulation(text(args, "id")),

  // --- experiments ----------------------------------------------------------------------------
  list_experiments: () => mockListExperiments(),
  list_experiments_page: async (args) => paginate(await mockListExperiments(), args),
  list_performance_results: () => mockListPerformanceResults(),
  list_performance_results_page: async (args) => paginate(await mockListPerformanceResults(), args),
  save_experiment_with_performance: (args) =>
    mockSaveExperimentWithPerformance(record(args, "payload") as never),
  update_experiment: (args) =>
    mockUpdateExperimentRecord(text(args, "id"), record(args, "payload") as never),
  delete_experiment: (args) => mockDeleteExperimentRecord(text(args, "id")),
  update_performance_result: (args) =>
    mockUpdatePerformanceResult(text(args, "id"), record(args, "payload") as never),
  delete_performance_result: (args) => mockDeletePerformanceResult(text(args, "id")),
  list_attachments: () => [],
  get_experiment_with_results: async (args) => ({
    experiment: (await mockListExperiments()).find((item) => item.id === text(args, "id")),
    experiments: [],
    results: (await mockListPerformanceResults()).filter(
      (item) => item.experimentId === text(args, "id")
    )
  }),
  list_formulation_experiments: async (args) => {
    const experiments = (await mockListExperiments()).filter(
      (item) => item.formulationId === text(args, "formulationId")
    );
    const ids = new Set(experiments.map((item) => item.id));
    return {
      experiments,
      results: (await mockListPerformanceResults()).filter((item) => ids.has(item.experimentId))
    };
  },

  // --- analysis -------------------------------------------------------------------------------
  get_dashboard_summary: () => mockGetDashboardSummary(),
  list_performance_metrics: () => ({ metrics: [] }),
  get_performance_distribution: (args) => insufficientData(text(args, "metric")),
  compare_performance_by_group: (args) => insufficientData(text(args, "metric")),
  get_concentration_performance: (args) => insufficientData(text(args, "metric")),
  get_descriptor_property_correlation: (args) => insufficientData(text(args, "metric")),

  // --- models ---------------------------------------------------------------------------------
  // The demo has no workspace to fit anything on, and a fabricated model would produce
  // fabricated predictions — the one thing this application must never do.
  list_models: () => ({ items: [] }),
  list_model_jobs: () => ({ items: [] }),

  // --- import and export ----------------------------------------------------------------------
  // The two-stage import: a preview that writes nothing, then a confirmation that writes
  // everything or nothing. The demo answers both so the flow can be walked through in a browser.
  preview_table_import: async (args) => {
    const previewed = (await mockImportExcelWithSidecar(text(args, "filePath"))) as Record<string, unknown>;
    const rows = Array.isArray(previewed.preview_rows) ? (previewed.preview_rows as Record<string, unknown>[]) : [];
    const columns = Array.isArray(previewed.columns) ? (previewed.columns as string[]) : [];
    return {
      filePath: text(args, "filePath"),
      fileName: text(args, "filePath").split(/[\\/]/).pop() ?? "",
      detectedKind: "preview_only",
      columns,
      previewRows: rows,
      sheetNames: [],
      importable: false,
      // i18n-exempt: browser-demo mode only; the desktop application never reaches this branch.
      warnings: ["The browser demo previews a file but cannot write to a workspace database."],
      fingerprint: "demo"
    };
  },
  confirm_table_import: () => ({
    importKind: "preview_only",
    importedCount: 0,
    skippedCount: 0,
    createdMoleculeCount: 0,
    rejected: [],
    // i18n-exempt: as above.
    warnings: ["The browser demo cannot import records; use the desktop application."]
  }),
  export_all_descriptors_csv: async () => ({ content: await mockExportAllDescriptorsCsv() }),
  export_ml_descriptor_matrix_csv: async (args) => ({
    content: await mockExportMlDescriptorMatrixCsv(record(args, "options") as never)
  }),
  export_molecule_library_csv: async () => ({
    content: buildMoleculeLibraryCsv((await mockListMolecules()) as Molecule[])
  }),

  // --- sketcher -------------------------------------------------------------------------------
  validate_smiles_with_sidecar: (args) => {
    const smiles = text(args, "smiles").trim();
    return {
      valid: Boolean(smiles),
      canonical_smiles: smiles,
      smiles_canonical: smiles,
      // i18n-exempt: browser-demo formulas, never reached in the desktop application.
      formula: smiles.includes("O") ? "C2H6O" : "C1H2",
      molecular_weight: smiles.length * 7.1 + 18,
      inchi_key: `DEMO-${Math.abs(hash(smiles))}`
    };
  },
  molfile_to_smiles_with_sidecar: (args) => {
    const molfile = text(args, "molfile");
    const ethanol = molfile.includes("CCO");
    return {
      valid: Boolean(molfile.trim()),
      canonical_smiles: ethanol ? "CCO" : "",
      // i18n-exempt: browser-demo chemistry values, not interface text.
      formula: ethanol ? "C2H6O" : "",
      molecular_weight: ethanol ? 46.069 : 0,
      // i18n-exempt: an InChIKey is an identifier.
      inchi_key: ethanol ? "LFQSCWFLJHTTHZ-UHFFFAOYSA-N" : ""
    };
  },
  smiles_to_molfile_with_sidecar: (args) => {
    const smiles = text(args, "smiles");
    return {
      valid: Boolean(smiles.trim()),
      molfile: buildMock3dMolBlock(smiles, smiles.trim() || "LMD"),
      canonical_smiles: smiles.trim()
    };
  },
  calculate_sketcher_descriptors_with_sidecar: () => ({
    valid: true,
    descriptor_count: 8,
    descriptors: {
      rdkit: { descriptors: { MolWt: 46.069, MolLogP: -0.001, TPSA: 20.23, NumHDonors: 1, NumHAcceptors: 1 } },
      mordred: { descriptors: { ABC: 1.414, nAtom: 9 } }
    },
    preview: { MolWt: 46.069, LogP: -0.001, TPSA: 20.23, HBD: 1, HBA: 1, RotatableBonds: 0 },
    rdkit_status: "mock",
    mordred_status: "mock"
  }),
  check_molecule_duplicate: (args) => {
    const payload = record(args, "payload");
    const canonicalSmiles = String(payload.canonicalSmiles ?? "");
    const inchikey = String(payload.inchikey ?? "");
    const existing = molecules.find(
      (item) => item.smilesCanonical === canonicalSmiles || (inchikey && item.inchiKey === inchikey)
    );
    return existing
      ? { duplicate: true, existing_molecule_id: existing.id, matched_by: "canonical_smiles" }
      : { duplicate: false };
  },
  import_new_molecule: (args) => {
    const payload = record(args, "payload") as Record<string, never>;
    const id = `mol-${molecules.length + 1}`;
    const name = String(payload.name ?? "");
    const canonicalSmiles = String(payload.canonicalSmiles ?? "");
    const molBlock = buildMock3dMolBlock(canonicalSmiles, name || canonicalSmiles);
    molecules.unshift({
      id,
      name,
      aliases: "",
      smilesRaw: String(payload.originalSmiles ?? ""),
      smilesCanonical: canonicalSmiles,
      inchi: "",
      inchiKey: String(payload.inchikey ?? ""),
      formula: String(payload.formula ?? ""),
      molecularWeight: Number(payload.molecularWeight ?? 0),
      category: payload.category as never,
      additiveFunctionTags: (payload.tags as unknown as string[]) ?? [],
      tags: (payload.tags as unknown as string[]) ?? [],
      molfile: String(payload.molfile ?? "") || molBlock,
      duplicateOf: String(payload.duplicateOf ?? ""),
      importMode: payload.importMode as never,
      source: String(payload.source ?? ""),
      structureSvgPath: `files/structures/${id}.svg`,
      structureSvg: mockSvg(name || String(payload.formula ?? "") || canonicalSmiles),
      molFilePath: `files/structures/${id}.mol`,
      sdfFilePath: `files/structures/${id}.sdf`,
      pdbFilePath: `files/structures/${id}.pdb`,
      molBlock,
      sdfBlock: buildMockSdfBlock(molBlock),
      // i18n-exempt: a browser-demo placeholder name inside a generated PDB block.
      pdbBlock: buildMockPdbBlock(canonicalSmiles, name || "DEMO MOLECULE"),
      rdkitDescriptorStatus: "mock",
      mordredDescriptorStatus: "mock",
      descriptorReady: true,
      sourceId: String(payload.source ?? ""),
      dataSource: String(payload.source ?? ""),
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    moleculeDescriptors.push({
      id: `${id}-sketcher`,
      moleculeId: id,
      descriptorSet: "rdkit",
      descriptorVersion: "sketcher-demo",
      descriptorsJson: (payload.descriptorJson as unknown as Record<string, number>) ?? {},
      descriptorCount: Object.keys(payload.descriptorJson ?? {}).length,
      status: "mock",
      mode: "mock",
      errorMessage: "",
      calculatedAt: new Date().toISOString()
    });
    return {
      success: true,
      molecule_id: id,
      duplicate: Boolean(payload.duplicateOf),
      duplicate_of: String(payload.duplicateOf ?? "")
    };
  }
};

/**
 * Answers one command with demo data, or refuses.
 *
 * A command with no entry here is refused rather than answered with an empty object: silently
 * returning `{}` is how a demo starts looking like a broken desktop build.
 */
export async function dispatchDemoCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const handler = HANDLERS[command];
  if (!handler) {
    throw new Error(
      coded(
        "app.desktopOnly",
        `The browser demo does not implement ${command}; it needs the desktop application.`
      )
    );
  }
  return (await handler(args)) as T;
}

/** Every command the demo can answer, for the separation tests. */
export function demoCommands() {
  return Object.keys(HANDLERS).sort();
}

function hash(value: string) {
  return value.split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 0);
}
