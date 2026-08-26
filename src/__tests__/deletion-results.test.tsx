// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toEntityDeletion, hasCleanupFailures } from "../lib/api/deletion";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

import FormulationLibraryPage from "../features/formulations/FormulationLibraryPage";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";

/** One page of formulations, in the shape `list_formulations_page` returns. */
function formulationPage(items: unknown[]) {
  return { items, total: items.length, page: 1, pageSize: 10, hasMore: false };
}


const en = messagesForLanguage("en-US");

/** Presses OK on the Ant Design confirmation dialog, which lives in a portal of its own. */
async function confirmModal() {
  const ok = await waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>(".ant-modal-confirm-btns .ant-btn-primary");
    if (!button) throw new Error("the confirmation dialog has not opened");
    return button;
  });
  fireEvent.click(ok);
}

beforeEach(async () => {
  window.localStorage.clear();
  // A fresh mock per test: `mockResolvedValue` from one test would otherwise leak into the next.
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
});

afterEach(() => {
  cleanup();
  // Ant Design's static dialogs and toasts render into portals of their own, which `cleanup` does
  // not own, and which close with an animation rather than immediately. Left behind, they make the
  // next test read the previous test's dialog.
  Modal.destroyAll();
  // `message.destroy()` tears down the singleton for the whole file, so the leftover notices are
  // removed from the DOM instead.
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

describe("the deletion result mapping", () => {
  it("always produces an array of cleanup failures", () => {
    // Every caller reads `cleanupFailures` directly; a missing field would make that a crash.
    expect(toEntityDeletion({ success: true, deleted: true })).toEqual({
      success: true,
      deleted: true,
      cleanupFailures: []
    });
    expect(toEntityDeletion(undefined).cleanupFailures).toEqual([]);
    expect(toEntityDeletion({ deleted: true, cleanupFailures: null }).cleanupFailures).toEqual([]);
  });

  it("unwraps the command envelope the backend sends", () => {
    const result = toEntityDeletion({
      ok: true,
      command: "delete_molecule",
      data: { success: true, deleted: true, cleanupFailures: ["files/imports/a.csv: refused"] }
    });

    expect(result.deleted).toBe(true);
    expect(result.cleanupFailures).toEqual(["files/imports/a.csv: refused"]);
    expect(hasCleanupFailures(result)).toBe(true);
  });

  it("treats a delete that removed the row as successful even when files survived", () => {
    // The row is gone, so the operation succeeded; the leftover files are a separate fact.
    const result = toEntityDeletion({ deleted: true, cleanupFailures: ["a.mol: refused"] });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(hasCleanupFailures(result)).toBe(true);
  });

  it("reports a record that was not there as not deleted", () => {
    const result = toEntityDeletion({ success: false, deleted: false });

    expect(result.deleted).toBe(false);
    expect(hasCleanupFailures(result)).toBe(false);
  });

  it("drops empty entries so an empty list never reads as a warning", () => {
    expect(toEntityDeletion({ deleted: true, cleanupFailures: ["", "  real "] }).cleanupFailures).toEqual([
      "  real "
    ]);
  });
});

describe("molecule deletion", () => {
  const molecule = {
    id: "mol-1",
    name: "Ethanol",
    category: "candidate",
    formula: "C2H6O",
    inchiKey: "",
    smilesCanonical: "CCO",
    duplicateOf: "",
    mordredDescriptorStatus: "calculated",
    rdkitDescriptorStatus: "calculated"
  };

  async function openConfirmation() {
    apiMock.listMoleculePage.mockResolvedValue({ items: [molecule], total: 1, page: 1, pageSize: 10 });
    renderWithLanguage(<MoleculeLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: en["molecule.delete"] }));
    // The confirmation's own OK button, which Ant Design renders into a portal.
    await confirmModal();
  }

  it("warns with the surviving files instead of reporting a clean success", async () => {
    apiMock.deleteMolecule.mockResolvedValue({
      success: true,
      deleted: true,
      cleanupFailures: ["files/structures/mol-1.mol: Permission denied"]
    });

    await openConfirmation();

    // Ant Design renders a dialog title twice: once for assistive technology, once visibly.
    expect((await screen.findAllByText(en["deletion.cleanupTitle"])).length).toBeGreaterThan(0);
    expect(screen.getByText("files/structures/mol-1.mol: Permission denied")).toBeTruthy();
    expect(screen.getByText(en["deletion.cleanupHint"])).toBeTruthy();
    expect(screen.queryByText(en["deletion.moleculeDeleted"])).toBeNull();
  });

  it("reports a clean delete plainly", async () => {
    apiMock.deleteMolecule.mockResolvedValue({ success: true, deleted: true, cleanupFailures: [] });

    await openConfirmation();

    expect(await screen.findByText(en["deletion.moleculeDeleted"])).toBeTruthy();
    expect(screen.queryByText(en["deletion.cleanupTitle"])).toBeNull();
  });

  it("says nothing was deleted when the record had already gone", async () => {
    apiMock.deleteMolecule.mockResolvedValue({ success: false, deleted: false, cleanupFailures: [] });

    await openConfirmation();

    expect(await screen.findByText(en["deletion.notFound"])).toBeTruthy();
    expect(apiMock.listMoleculePage).toHaveBeenCalledTimes(1);
  });
});

describe("formulation and experiment deletion", () => {
  const formulation = {
    id: "form-1",
    name: "PAO-6 + ZDDP",
    baseOil: "PAO-6",
    additiveCount: 1,
    components: [],
    experimentCount: 1
  };

  it("warns with the surviving files when a formulation is deleted", async () => {
    apiMock.listFormulationPage.mockResolvedValue(formulationPage([formulation]));
    apiMock.deleteFormulation.mockResolvedValue({
      success: true,
      deleted: true,
      cleanupFailures: ["files/imports/report.csv: Permission denied"]
    });

    renderWithLanguage(<FormulationLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: en["ui.delete"] }));
    await confirmModal();

    expect((await screen.findAllByText(en["deletion.cleanupTitle"])).length).toBeGreaterThan(0);
    expect(screen.getByText("files/imports/report.csv: Permission denied")).toBeTruthy();
  });

  it("reports a clean formulation delete plainly", async () => {
    apiMock.listFormulationPage.mockResolvedValue(formulationPage([formulation]));
    apiMock.deleteFormulation.mockResolvedValue({ success: true, deleted: true, cleanupFailures: [] });

    renderWithLanguage(<FormulationLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: en["ui.delete"] }));
    await confirmModal();

    await waitFor(() => expect(apiMock.deleteFormulation).toHaveBeenCalledWith("form-1"));
    expect(await screen.findByText(en["deletion.formulationDeleted"])).toBeTruthy();
    expect(screen.queryByText(en["deletion.cleanupTitle"])).toBeNull();
  });
});
