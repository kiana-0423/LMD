// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiMock } from "./apiMock";
import { LanguageProvider } from "../i18n/LanguageContext";

/**
 * Deleting a base oil that formulations still use.
 *
 * The old command removed the referencing components and reported success, so every affected blend
 * silently lost the oil it was built on. These assertions pin the replacement: nothing is deleted,
 * the formulations are named on screen, and removing them anyway takes a second, explicit decision.
 */

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, hasMore: false });

const BASE_OIL = {
  id: "bo-1",
  name: "PAO 6",
  baseOilType: "PAO",
  representativeMoleculeId: "",
  viscosity40c: 32,
  viscosity100c: 6,
  viscosityIndex: 130,
  density: 0.83,
  pourPoint: -60,
  flashPoint: 240,
  supplier: "",
  batchNumber: "",
  formulationCount: 2,
  notes: "",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
};

const BLOCKED = {
  id: "bo-1",
  deleted: false,
  success: false,
  blocked: true,
  blockedBy: [
    { formulationId: "f-1", formulationName: "PAO 6 + ZDDP 1%", componentCount: 1, componentRoles: ["base_oil"] },
    { formulationId: "f-2", formulationName: "PAO 6 + MoDTC 0.5%", componentCount: 2, componentRoles: ["base_oil"] }
  ],
  removedComponents: 0,
  cleanupFailures: []
};

const deleteBaseOil = vi.fn();
const deleteBaseOilWithComponents = vi.fn();

vi.mock("../lib/api", async () => {
  const { createApiMock: build } = await import("./apiMock");
  return build({
    listBaseOilPage: () => Promise.resolve(page([BASE_OIL])),
    listAdditivePage: () => Promise.resolve(page([])),
    deleteBaseOil: (...args: unknown[]) => deleteBaseOil(...args),
    deleteBaseOilWithComponents: (...args: unknown[]) => deleteBaseOilWithComponents(...args)
  });
});

async function openPage() {
  const { default: BaseAdditiveLibraryPage } = await import(
    "../features/base-additive/BaseAdditiveLibraryPage"
  );
  render(
    <LanguageProvider>
      <BaseAdditiveLibraryPage />
    </LanguageProvider>
  );
  // Waiting for the row itself: the page is ready once the paged read has resolved and the table
  // has rendered a record, whichever column happens to show its name.
  await waitFor(() => expect(document.querySelector('[data-row-key="bo-1"]')).toBeTruthy());
}

/** Clicks Delete on the row, then confirms Ant Design's own confirmation. */
async function requestDelete() {
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  // Ant Design's confirm renders its title twice (visible text plus an aria label), so the dialog
  // is located by role and the button is found inside it.
  const dialogs = await screen.findAllByRole("dialog");
  // The confirmation is the one carrying the question, not the blocked-deletion modal.
  const confirmation = dialogs.find((dialog) => dialog.textContent?.includes("Delete this base oil?"));
  fireEvent.click(within(confirmation as HTMLElement).getByRole("button", { name: "Delete" }));
}

describe("deleting a referenced base oil", () => {
  beforeEach(() => {
    deleteBaseOil.mockReset();
    deleteBaseOilWithComponents.mockReset();
  });

  afterEach(() => {
    // `Modal.confirm` appends to `document.body`, outside the container React Testing Library
    // cleans up. Left there, the next test finds two dialogs and clicks the wrong one.
    cleanup();
    Modal.destroyAll();
    document.body.innerHTML = "";
  });

  it("names the formulations standing in the way and deletes nothing", async () => {
    deleteBaseOil.mockResolvedValue(BLOCKED);
    await openPage();

    await requestDelete();

    expect(await screen.findByText("This record is still in use")).toBeTruthy();
    expect(screen.getByText("PAO 6 + ZDDP 1%")).toBeTruthy();
    expect(screen.getByText("PAO 6 + MoDTC 0.5%")).toBeTruthy();
    // The safe delete was attempted; the destructive one was not.
    expect(deleteBaseOil).toHaveBeenCalledWith("bo-1");
    expect(deleteBaseOilWithComponents).not.toHaveBeenCalled();
  });

  it("says how much the cascade would destroy before it can be run", async () => {
    deleteBaseOil.mockResolvedValue(BLOCKED);
    await openPage();
    await requestDelete();
    await screen.findByText("This record is still in use");

    // Three components across two formulations, from the counts the backend reported.
    expect(screen.getByText(/3 component\(s\) from 2 formulation\(s\)/)).toBeTruthy();
  });

  it("requires the acknowledgement before the cascading delete can be started", async () => {
    deleteBaseOil.mockResolvedValue(BLOCKED);
    deleteBaseOilWithComponents.mockResolvedValue({
      ...BLOCKED,
      deleted: true,
      success: true,
      blocked: false,
      removedComponents: 3
    });
    await openPage();
    await requestDelete();
    await screen.findByText("This record is still in use");

    const cascade = screen.getByRole("button", { name: "Delete it and remove those components" });
    expect(cascade.hasAttribute("disabled")).toBe(true);
    fireEvent.click(cascade);
    expect(deleteBaseOilWithComponents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(cascade.hasAttribute("disabled")).toBe(false));
    fireEvent.click(cascade);

    await waitFor(() => expect(deleteBaseOilWithComponents).toHaveBeenCalledWith("bo-1"));
  });

  it("deletes an unreferenced record without any of this", async () => {
    deleteBaseOil.mockResolvedValue({
      id: "bo-1",
      deleted: true,
      success: true,
      blocked: false,
      blockedBy: [],
      removedComponents: 0,
      cleanupFailures: []
    });
    await openPage();

    await requestDelete();

    await waitFor(() => expect(deleteBaseOil).toHaveBeenCalledWith("bo-1"));
    expect(screen.queryByText("This record is still in use")).toBeNull();
  });
});

describe("the shared API mock", () => {
  it("covers the deletion outcome shape", () => {
    const mock = createApiMock() as Record<string, () => Promise<unknown>>;
    expect(mock.deleteBaseOilWithComponents).toBeTypeOf("function");
  });
});
