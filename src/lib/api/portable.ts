import { invokeCommand } from "../tauri";
import type { IntegrityReport } from "../../types";

export interface WorkspaceArchive {
  path: string;
  sha256: string;
  manifest: {
    format: "lmd-workspace";
    version: number;
    appVersion: string;
    schemaVersion: number;
    createdAt: string;
    sourcePlatform: string;
    tableCounts: Record<string, number>;
    files: { path: string; size: number; sha256: string }[];
  };
}

export interface WorkspaceArchiveImport {
  workspacePath: string;
  fileCount: number;
  report: IntegrityReport;
}

export function exportWorkspaceArchive(path: string) {
  return invokeCommand<WorkspaceArchive>("export_workspace_archive", { path });
}

export function previewWorkspaceArchive(path: string) {
  return invokeCommand<WorkspaceArchive>("preview_workspace_archive", { path });
}

export function importWorkspaceArchive(preview: WorkspaceArchive, parent: string) {
  return invokeCommand<WorkspaceArchiveImport>("import_workspace_archive", {
    path: preview.path,
    parent,
    expectedSha256: preview.sha256
  });
}
