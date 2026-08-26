import type { ExportResult } from "../../types";
import { downloadTextFile } from "../downloads";

type ExportPayload = { path?: string; row_count?: number; column_count?: number };
type RawExport = { data?: ExportPayload; content?: string } & ExportPayload;

/**
 * Normalises the two shapes an export can take: Rust writes a file and returns its path, while
 * browser mock mode returns CSV text for the caller to download.
 */
export async function unwrapExport(pending: Promise<unknown>, fallbackFileName: string): Promise<ExportResult> {
  const value = (await pending) as RawExport;
  const data: ExportPayload = value?.data ?? value ?? {};
  if (data.path) {
    return { savedPath: data.path, rowCount: data.row_count ?? 0, columnCount: data.column_count ?? 0 };
  }
  return { content: value?.content ?? "", fileName: fallbackFileName };
}

/**
 * Message for either export shape, so every caller reports the same thing.
 *
 * `subject` and the surrounding words are both already-translated text: the caller looks them up,
 * because this module has no access to the language context and a string built here would be
 * English wherever it was shown.
 */
export function describeExport(
  result: ExportResult,
  subject: string,
  words: { savedTo: string; exported: string }
) {
  return result.savedPath
    ? `${subject} ${words.savedTo} ${result.rowCount} — ${result.savedPath}`
    : `${subject} ${words.exported}`;
}

/** Downloads the CSV when Rust did not already write it to the workspace. */
export function deliverExport(result: ExportResult) {
  if (result.savedPath || !result.content) return;
  downloadTextFile(result.fileName ?? "export.csv", result.content, "text/csv;charset=utf-8");
}
