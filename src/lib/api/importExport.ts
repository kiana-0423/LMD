import type { ExportResult } from "../../types";
import { invokeCommand } from "../tauri";
import { unwrapExport } from "./export";

/**
 * Rust streams the library straight from SQLite into the workspace `exports/` directory, so this
 * no longer walks every page over IPC just to build a file.
 */
export async function exportMoleculeLibraryCsv(): Promise<ExportResult> {
  return unwrapExport(invokeCommand("export_molecule_library_csv", {}), "molecule-library.csv");
}
