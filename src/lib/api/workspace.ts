import type {
  BackupRecord,
  DiagnosticsReport,
  DataQualityRow,
  DiagnosticsExport,
  IntegrityReport,
  RestoreOutcome,
  WorkspaceDetails
} from "../../types";
import { invokeCommand } from "../tauri";

/** Where this installation keeps its database, and what state that database is in. */
export async function getWorkspaceDetails() {
  return invokeCommand<WorkspaceDetails>("get_workspace_details", {});
}

/** Runs SQLite's own checks and reports exactly what they said. */
export async function checkDatabaseIntegrity() {
  return invokeCommand<IntegrityReport>("check_database_integrity", {});
}

export async function listWorkspaceBackups() {
  return invokeCommand<BackupRecord[]>("list_workspace_backups", {});
}

/** Takes a verified backup. A file that fails its own integrity check is discarded, not kept. */
export async function createWorkspaceBackup() {
  return invokeCommand<BackupRecord>("create_workspace_backup", {});
}

/**
 * Replaces the live database with a backup.
 *
 * `confirmReplace` is required by the backend and is passed explicitly here rather than defaulted:
 * a restore discards current work, and a parameter that defaults to "yes" is one that will
 * eventually be used by accident.
 */
export async function restoreWorkspaceBackup(path: string, confirmReplace: boolean) {
  return invokeCommand<RestoreOutcome>("restore_workspace_backup", { path, confirmReplace });
}

/** Legacy rows a current rule would reject, preserved rather than corrected. */
export async function listRowsNeedingAttention() {
  return invokeCommand<DataQualityRow[]>("list_rows_needing_attention", {});
}

export async function createWorkspace(path: string) {
  return invokeCommand<unknown>("create_workspace", { path });
}

export async function openWorkspace(path: string) {
  return invokeCommand<unknown>("open_workspace", { path });
}

/**
 * Builds the diagnostics report without writing it anywhere.
 *
 * Shown on screen before it is exported, so a user can see exactly what the file will contain
 * before deciding whether to send it to anybody.
 */
export async function getDiagnostics() {
  return invokeCommand<DiagnosticsReport>("get_diagnostics", {});
}

/**
 * Writes a diagnostics report into the workspace's exports folder.
 *
 * The report carries versions, paths, counts and error messages — never molecule structures,
 * descriptor values or model files.
 */
export async function exportDiagnostics() {
  return invokeCommand<DiagnosticsExport>("export_diagnostics", {});
}
