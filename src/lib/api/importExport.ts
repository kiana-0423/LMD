import type { Molecule } from "../../types";
import { mockImportExcelWithSidecar } from "../api.mock";
import { invokeOrMock } from "../tauri";
import { listMolecules } from "./molecule";

export async function exportMoleculeLibraryCsv() {
  return buildMoleculeLibraryCsv(await listMolecules());
}

export async function importExcelWithSidecar(filePath: string) {
  return invokeOrMock<Record<string, unknown>>("import_excel_with_sidecar", { filePath }, () =>
    mockImportExcelWithSidecar(filePath)
  ).then((value) => {
    const data = value.data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : value;
  });
}

function buildMoleculeLibraryCsv(allMolecules: Molecule[]) {
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

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
}
