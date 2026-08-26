// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageContext";

/**
 * Everything Settings has to be able to answer about a workspace.
 *
 * Before this, the database path existed only as a line in the status bar, there was no way to ask
 * SQLite whether the file was sound, and the only backup anyone could make was a copy of
 * `lmd.sqlite` — which, in WAL mode, silently omits the most recent transactions.
 */

const getWorkspaceDetails = vi.fn();
const checkDatabaseIntegrity = vi.fn();
const listWorkspaceBackups = vi.fn();
const createWorkspaceBackup = vi.fn();
const restoreWorkspaceBackup = vi.fn();
const listRowsNeedingAttention = vi.fn();
const openWorkspace = vi.fn();
const chooseFolder = vi.fn();

vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock({
    getWorkspaceDetails: (...args: unknown[]) => getWorkspaceDetails(...args),
    checkDatabaseIntegrity: (...args: unknown[]) => checkDatabaseIntegrity(...args),
    listWorkspaceBackups: (...args: unknown[]) => listWorkspaceBackups(...args),
    createWorkspaceBackup: (...args: unknown[]) => createWorkspaceBackup(...args),
    restoreWorkspaceBackup: (...args: unknown[]) => restoreWorkspaceBackup(...args),
    listRowsNeedingAttention: (...args: unknown[]) => listRowsNeedingAttention(...args),
    openWorkspace: (...args: unknown[]) => openWorkspace(...args)
  });
});

vi.mock("../lib/dialogs", () => ({
  chooseFile: vi.fn(),
  chooseFolder: (...args: unknown[]) => chooseFolder(...args),
  chooseSaveDestination: vi.fn(),
  nativeDialogsAvailable: () => true,
  TABLE_FILTERS: [],
  ATTACHMENT_FILTERS: []
}));

const DETAILS = {
  workspacePath: "~/LMD_Workspace",
  databasePath: "~/LMD_Workspace/lmd.sqlite",
  databaseExists: true,
  databaseSizeBytes: 4_194_304,
  schemaVersion: 6,
  supportedSchemaVersion: 6,
  backupCount: 1,
  automaticBackupLimit: 10,
  rowsNeedingAttention: 0
};

const BACKUP = {
  fileName: "auto-2026-02-01T00-00-00Z.sqlite",
  path: "/w/backups/auto-2026-02-01T00-00-00Z.sqlite",
  sizeBytes: 4_000_000,
  createdAt: "2026-02-01T00-00-00Z",
  automatic: true
};

function defaults() {
  getWorkspaceDetails.mockResolvedValue(DETAILS);
  listWorkspaceBackups.mockResolvedValue([BACKUP]);
  listRowsNeedingAttention.mockResolvedValue([]);
}

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  document.body.innerHTML = "";
  for (const mock of [
    getWorkspaceDetails,
    checkDatabaseIntegrity,
    listWorkspaceBackups,
    createWorkspaceBackup,
    restoreWorkspaceBackup,
    listRowsNeedingAttention,
    openWorkspace,
    chooseFolder
  ]) {
    mock.mockReset();
  }
});

async function openSettings() {
  const { default: WorkspaceCard } = await import("../features/settings/WorkspaceCard");
  render(
    <LanguageProvider>
      <WorkspaceCard />
    </LanguageProvider>
  );
  await screen.findByText("~/LMD_Workspace/lmd.sqlite");
}

describe("workspace settings", () => {
  it("shows where the workspace and its database are, and which schema version it holds", async () => {
    defaults();
    await openSettings();

    expect(screen.getByText("~/LMD_Workspace")).toBeTruthy();
    expect(screen.getByText("~/LMD_Workspace/lmd.sqlite")).toBeTruthy();
    expect(screen.getByText("4.0 MB")).toBeTruthy();
    expect(screen.getByText("6 / 6")).toBeTruthy();
  });

  it("reports exactly what SQLite said when the integrity check runs", async () => {
    defaults();
    checkDatabaseIntegrity.mockResolvedValue({
      ok: false,
      integrity: "*** in database main *** Page 42 is never used",
      foreignKeyViolations: 3,
      schemaVersion: 6,
      dataQualityIssues: 0
    });
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: "Check database integrity" }));

    // SQLite's own words, quoted rather than paraphrased into "something went wrong".
    expect(await screen.findByText("*** in database main *** Page 42 is never used")).toBeTruthy();
    expect(screen.getByText("Dangling references: 3")).toBeTruthy();
  });

  it("takes a backup and lists it", async () => {
    defaults();
    createWorkspaceBackup.mockResolvedValue(BACKUP);
    await openSettings();

    expect(screen.getByText("auto-2026-02-01T00-00-00Z.sqlite")).toBeTruthy();
    expect(screen.getByText("Automatic")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));
    await waitFor(() => expect(createWorkspaceBackup).toHaveBeenCalled());
    // The list is re-read afterwards, so a backup that was taken is a backup that is shown.
    await waitFor(() => expect(listWorkspaceBackups.mock.calls.length).toBeGreaterThan(1));
  });

  it("asks before replacing the current database, and says what that costs", async () => {
    defaults();
    restoreWorkspaceBackup.mockResolvedValue({
      restoredFrom: BACKUP.path,
      previousDatabaseBackup: "/w/backups/auto-before-restore.sqlite",
      report: { ok: true, integrity: "ok", foreignKeyViolations: 0, schemaVersion: 6, dataQualityIssues: 0 }
    });
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Everything recorded since this backup was taken/)).toBeTruthy();
    // Nothing has happened yet.
    expect(restoreWorkspaceBackup).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(restoreWorkspaceBackup).toHaveBeenCalledWith(BACKUP.path, true)
    );
  });

  it("offers a reload after a workspace switch rather than leaving stale records on screen", async () => {
    defaults();
    chooseFolder.mockResolvedValue("/lab/other-workspace");
    openWorkspace.mockResolvedValue({});
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith("/lab/other-workspace"));
    expect(await screen.findByRole("button", { name: "Reload now" })).toBeTruthy();
  });

  it("lists legacy rows a current rule would reject, and says they were preserved", async () => {
    defaults();
    listRowsNeedingAttention.mockResolvedValue([
      {
        tableName: "formulations",
        rowId: "f-legacy",
        rule: "formulation_preparation_time_is_not_negative",
        detail: "A preparation time cannot be negative."
      }
    ]);
    await openSettings();

    expect(await screen.findByText("f-legacy")).toBeTruthy();
    expect(screen.getByText("A preparation time cannot be negative.")).toBeTruthy();
    expect(screen.getByText(/preserved exactly as they were, never corrected/)).toBeTruthy();
  });
});
