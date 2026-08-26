import type { ImportOutcome, ImportPreview } from "../../types";
import { invokeCommand } from "../tauri";

/**
 * Reads a file and reports what an import would do. Writes nothing.
 *
 * The two halves used to be one command, so by the time anyone saw the detected record type or the
 * warnings, the rows were already stored. Splitting them is what makes the preview a preview.
 */
export async function previewTableImport(filePath: string) {
  return invokeCommand<ImportPreview>("preview_table_import", { filePath });
}

/**
 * Writes the rows the user reviewed, in one transaction.
 *
 * The fingerprint comes from the preview and identifies the exact bytes that were shown. If the
 * file changed in between — a spreadsheet left open and saved again is enough — the import is
 * refused rather than writing rows nobody reviewed.
 */
export async function confirmTableImport(preview: ImportPreview) {
  return invokeCommand<ImportOutcome>("confirm_table_import", {
    filePath: preview.filePath,
    fingerprint: preview.fingerprint,
    detectedKind: preview.detectedKind
  });
}
