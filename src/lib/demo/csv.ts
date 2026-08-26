import type { Molecule } from "../../types";
import { toCsv } from "../downloads";

/**
 * The molecule-library CSV, built in the browser.
 *
 * The desktop build never runs this: Rust streams the library straight from SQLite into the
 * workspace's `exports/` folder. It lives here because it exists only to give the demo something
 * to download, and everything that exists only for the demo belongs behind the demo's door.
 */
export function buildMoleculeLibraryCsv(allMolecules: Molecule[]) {
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
