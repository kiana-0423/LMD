import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./tauri";
import { coded } from "./backendErrors";

/**
 * Native file and folder pickers.
 *
 * Every one of these used to be a text field the user typed an absolute path into. That is
 * unpleasant on any platform and actively hostile on Windows, and it is also a reliable source of
 * paths that do not exist — a typo becomes a backend error about a missing file rather than a
 * dialog that simply would not have let it happen.
 *
 * The plugin is granted `dialog:allow-open` and `dialog:allow-save` and nothing else. A dialog
 * returns a *path*; it does not grant the interface any ability to read or write it. Every path
 * still goes to a Rust command that validates it against the workspace before touching anything.
 *
 * Outside Tauri these refuse rather than falling back to a prompt: a browser cannot produce a real
 * filesystem path, and a typed one would be a path on a machine the code is not running on.
 */

/** Raised when a dialog is asked for outside the desktop application. */
function refuse(): never {
  throw new Error(
    coded("app.desktopOnly", "Choosing a file or folder needs the desktop application.")
  );
}

/** Whether native dialogs are available at all. Screens use this to disable a Browse button. */
export function nativeDialogsAvailable() {
  return isTauriRuntime();
}

export type FileFilter = { name: string; extensions: string[] };

/** The spreadsheet formats the importer accepts. */
export const TABLE_FILTERS: FileFilter[] = [
  { name: "Table", extensions: ["csv", "xlsx", "xlsm"] }
];

/** Anything a user might attach to a record. */
export const ATTACHMENT_FILTERS: FileFilter[] = [
  { name: "Attachment", extensions: ["csv", "xlsx", "xlsm", "pdf", "png", "jpg", "jpeg", "txt", "json"] }
];

/**
 * Asks for one existing file.
 *
 * Returns `undefined` when the user cancelled, which is not an error and must not be reported as
 * one — cancelling a dialog is a decision, not a failure.
 */
export async function chooseFile(options: { title: string; filters?: FileFilter[] }) {
  if (!nativeDialogsAvailable()) refuse();
  const selected = await openDialog({
    title: options.title,
    multiple: false,
    directory: false,
    filters: options.filters
  });
  return typeof selected === "string" ? selected : undefined;
}

/** Asks for one existing folder — a workspace to open, or a parent for a new one. */
export async function chooseFolder(options: { title: string }) {
  if (!nativeDialogsAvailable()) refuse();
  const selected = await openDialog({ title: options.title, multiple: false, directory: true });
  return typeof selected === "string" ? selected : undefined;
}

/** Asks where to write a file, with a suggested name. */
export async function chooseSaveDestination(options: {
  title: string;
  defaultPath?: string;
  filters?: FileFilter[];
}) {
  if (!nativeDialogsAvailable()) refuse();
  const selected = await saveDialog({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters
  });
  return typeof selected === "string" ? selected : undefined;
}
