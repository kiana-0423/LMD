// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageContext";
import WorkspaceArchiveCard from "../features/import-export/WorkspaceArchiveCard";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(), export: vi.fn(), import: vi.fn(), open: vi.fn(),
  chooseFile: vi.fn(), chooseFolder: vi.fn(), chooseSave: vi.fn()
}));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock({ previewWorkspaceArchive: mocks.preview, exportWorkspaceArchive: mocks.export,
    importWorkspaceArchive: mocks.import, openWorkspace: mocks.open });
});
vi.mock("../lib/dialogs", () => ({
  chooseFile: mocks.chooseFile, chooseFolder: mocks.chooseFolder, chooseSaveDestination: mocks.chooseSave,
  nativeDialogsAvailable: () => true
}));
const PREVIEW = {
  path: "/transfer/backup.zip", sha256: "preview-hash",
  manifest: { schemaVersion: 10, sourcePlatform: "windows", createdAt: "2026-11-06",
    files: [{ path: "lmd.sqlite", size: 100, sha256: "db-hash" }], tableCounts: { molecules: 42, experiments: 7 } }
};
function click(label: string) { fireEvent.click(screen.getByText(label).closest("button")!); }
function show() { render(<LanguageProvider><WorkspaceArchiveCard /></LanguageProvider>); }
beforeEach(() => {
  mocks.chooseFile.mockResolvedValue(PREVIEW.path);
  mocks.preview.mockResolvedValue(PREVIEW);
  mocks.chooseFolder.mockResolvedValue("/restored");
});
afterEach(() => { cleanup(); Object.values(mocks).forEach((mock) => mock.mockReset()); });

it("previews table counts and files without importing or switching workspaces", async () => {
  show(); click("Select an LMD backup");
  expect(await screen.findByText("42")).toBeTruthy();
  expect(screen.getByText("windows")).toBeTruthy();
  expect(mocks.import).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("imports only the reviewed archive into a new workspace and offers an explicit switch", async () => {
  mocks.import.mockResolvedValue({ workspacePath: "/restored/LMD-Imported-123", fileCount: 1, report: { ok: true } });
  show(); click("Select an LMD backup"); await screen.findByText("42");
  click("Import into a new workspace");
  expect(await screen.findByText("/restored/LMD-Imported-123")).toBeTruthy();
  expect(mocks.import).toHaveBeenCalledWith(PREVIEW, "/restored");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(screen.queryByText("Import into a new workspace")).toBeNull();
  expect(screen.getByText("Open imported workspace")).toBeTruthy();
});

it("does not import when the destination dialog is cancelled", async () => {
  mocks.chooseFolder.mockResolvedValue(undefined);
  show(); click("Select an LMD backup"); await screen.findByText("42");
  click("Import into a new workspace");
  await waitFor(() => expect(mocks.chooseFolder).toHaveBeenCalledOnce());
  expect(mocks.import).not.toHaveBeenCalled();
});

it("clears a previous preview if the next archive cannot be read", async () => {
  show(); click("Select an LMD backup"); await screen.findByText("42");
  mocks.preview.mockRejectedValue(new Error("Broken backup"));
  click("Select an LMD backup");
  await waitFor(() => expect(screen.queryByText("Import into a new workspace")).toBeNull());
  expect(mocks.import).not.toHaveBeenCalled();
});

it("exports to the selected path and displays the completed archive", async () => {
  mocks.chooseSave.mockResolvedValue("/backup/complete.zip");
  mocks.export.mockResolvedValue({ ...PREVIEW, path: "/backup/complete.zip" });
  show(); click("Export complete workspace");
  expect(await screen.findByText("/backup/complete.zip")).toBeTruthy();
  expect(mocks.export).toHaveBeenCalledWith("/backup/complete.zip");
});

it("keeps a failed export visible as an error without claiming success", async () => {
  mocks.chooseSave.mockResolvedValue("/backup/complete.zip");
  mocks.export.mockRejectedValue(new Error("Disk full"));
  show(); click("Export complete workspace");
  expect(await screen.findByText(/Disk full/)).toBeTruthy();
  expect(screen.queryByText("Complete workspace exported")).toBeNull();
});
