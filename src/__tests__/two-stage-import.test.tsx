// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageContext";

/**
 * Importing a spreadsheet in two stages.
 *
 * It used to be one command that previewed *and* wrote. By the time the detected record type, the
 * column list and the warnings appeared on screen, every row was already in the database — so the
 * preview was a report of what had happened, presented as a chance to decide whether it should.
 */

const previewTableImport = vi.fn();
const confirmTableImport = vi.fn();
const chooseFile = vi.fn();

vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock({
    previewTableImport: (...args: unknown[]) => previewTableImport(...args),
    confirmTableImport: (...args: unknown[]) => confirmTableImport(...args)
  });
});

vi.mock("../lib/dialogs", () => ({
  chooseFile: (...args: unknown[]) => chooseFile(...args),
  chooseFolder: vi.fn(),
  chooseSaveDestination: vi.fn(),
  nativeDialogsAvailable: () => true,
  TABLE_FILTERS: [],
  ATTACHMENT_FILTERS: []
}));

const PREVIEW = {
  filePath: "/lab/base-oils.csv",
  fileName: "base-oils.csv",
  detectedKind: "base_oils",
  columns: ["name", "base_oil_type", "viscosity_40c"],
  previewRows: [{ name: "PAO 6", base_oil_type: "PAO", viscosity_40c: 31.5 }],
  sheetNames: [],
  importable: true,
  warnings: [],
  fingerprint: "1024-1700000000000"
};

afterEach(() => {
  cleanup();
  previewTableImport.mockReset();
  confirmTableImport.mockReset();
  chooseFile.mockReset();
  document.body.innerHTML = "";
});

/** The Browse button. Its icon contributes to the accessible name, so it is found by its text. */
function selectButton() {
  return screen.getByText("Select a CSV or Excel file").closest("button") as HTMLElement;
}

/** The confirm button, found the same way. */
function importButton() {
  return screen.getByText("Import these rows").closest("button") as HTMLElement;
}

async function openPage() {
  const { default: ImportExportPage } = await import("../features/import-export/ImportExportPage");
  render(
    <LanguageProvider>
      <ImportExportPage />
    </LanguageProvider>
  );
}

describe("two-stage table import", () => {
  it("previews without writing anything, and says so", async () => {
    chooseFile.mockResolvedValue("/lab/base-oils.csv");
    previewTableImport.mockResolvedValue(PREVIEW);
    await openPage();

    fireEvent.click(selectButton());

    expect(await screen.findByText("Preview — nothing has been imported yet")).toBeTruthy();
    expect(screen.getByText(/The database has not been changed/)).toBeTruthy();
    expect(previewTableImport).toHaveBeenCalledWith("/lab/base-oils.csv");
    // The decisive assertion: the write command has not run.
    expect(confirmTableImport).not.toHaveBeenCalled();
  });

  it("shows the detected type, the columns and the row count before anything is decided", async () => {
    chooseFile.mockResolvedValue("/lab/base-oils.csv");
    previewTableImport.mockResolvedValue(PREVIEW);
    await openPage();
    fireEvent.click(selectButton());
    await screen.findByText("Preview — nothing has been imported yet");

    expect(screen.getByText("Base Oil")).toBeTruthy();
    expect(screen.getByText("name, base_oil_type, viscosity_40c")).toBeTruthy();
    expect(screen.getByText("base-oils.csv")).toBeTruthy();
  });

  it("writes only when the user confirms, and passes the previewed fingerprint back", async () => {
    chooseFile.mockResolvedValue("/lab/base-oils.csv");
    previewTableImport.mockResolvedValue(PREVIEW);
    confirmTableImport.mockResolvedValue({
      importKind: "base_oils",
      importedCount: 1,
      skippedCount: 0,
      createdMoleculeCount: 0,
      rejected: [],
      warnings: []
    });
    await openPage();
    fireEvent.click(selectButton());
    await screen.findByText("Preview — nothing has been imported yet");

    fireEvent.click(importButton());

    // The fingerprint identifies the exact bytes that were shown; the backend refuses the import
    // if the file changed in between.
    await waitFor(() => expect(confirmTableImport).toHaveBeenCalledWith(PREVIEW));
    expect(await screen.findByText("Import finished")).toBeTruthy();
  });

  it("reports rejected rows with a reason for each", async () => {
    chooseFile.mockResolvedValue("/lab/base-oils.csv");
    previewTableImport.mockResolvedValue(PREVIEW);
    confirmTableImport.mockResolvedValue({
      importKind: "base_oils",
      importedCount: 2,
      skippedCount: 1,
      createdMoleculeCount: 0,
      rejected: [{ row: 3, reason: "Skipped base oil row without name." }],
      warnings: []
    });
    await openPage();
    fireEvent.click(selectButton());
    await screen.findByText("Preview — nothing has been imported yet");
    fireEvent.click(importButton());

    expect(await screen.findByText("Skipped base oil row without name.")).toBeTruthy();
    // The row number, so the user can find it in their own file.
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("will not offer to import a file whose records it did not recognise", async () => {
    chooseFile.mockResolvedValue("/lab/notes.csv");
    previewTableImport.mockResolvedValue({
      ...PREVIEW,
      detectedKind: "preview_only",
      importable: false,
      warnings: ["No base oil or additive columns were recognised, so confirming would import nothing."]
    });
    await openPage();
    fireEvent.click(selectButton());
    await screen.findByText("Preview — nothing has been imported yet");

    expect(importButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Not recognised")).toBeTruthy();
  });

  it("treats a cancelled dialog as a decision, not a failure", async () => {
    chooseFile.mockResolvedValue(undefined);
    await openPage();

    fireEvent.click(selectButton());

    await waitFor(() => expect(previewTableImport).not.toHaveBeenCalled());
    expect(screen.queryByText("Preview — nothing has been imported yet")).toBeNull();
  });
});
