// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";

const api = vi.hoisted(() => ({
  listMoleculePage: vi.fn(), listBaseOilPage: vi.fn(), createBaseOil: vi.fn(), updateBaseOil: vi.fn()
}));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock(api);
});
import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";

const messages = messagesForLanguage("en-US");
beforeEach(() => {
  vi.clearAllMocks();
  api.listMoleculePage.mockResolvedValue({ items: [{ id: "mol-base", name: "Squalane" }], total: 1 });
  api.listBaseOilPage.mockResolvedValue({ items: [], total: 0 });
  api.createBaseOil.mockResolvedValue({});
  api.updateBaseOil.mockResolvedValue({});
});
afterEach(cleanup);

it("offers library selection first and saves the selected molecule association", async () => {
  renderWithLanguage(<BaseAdditiveLibraryPage />);
  fireEvent.click(screen.getByRole("button", { name: messages["ui.newBaseOil"] }));
  const dialog = await screen.findByRole("dialog");
  const picker = within(dialog).getByRole("combobox", { name: messages["ui.representativeMolecule"] });
  expect(dialog.querySelector(".ant-form-item")?.contains(picker)).toBe(true);
  fireEvent.mouseDown(picker);
  fireEvent.click(await screen.findByText("Squalane (mol-base)"));
  fireEvent.change(within(dialog).getByLabelText(messages["ui.name"]), { target: { value: "Squalane oil" } });
  fireEvent.click(within(dialog).getByRole("button", { name: messages["ui.save"] }));
  await waitFor(() => expect(api.createBaseOil).toHaveBeenCalledWith(expect.objectContaining({
    name: "Squalane oil", representativeMoleculeId: "mol-base"
  })));
});

it("retains the linked molecule during editing and explicitly clears it when requested", async () => {
  api.listBaseOilPage.mockResolvedValue({ items: [{ id: "oil-1", name: "Squalane oil", representativeMoleculeId: "mol-base" }], total: 1 });
  renderWithLanguage(<BaseAdditiveLibraryPage />);
  fireEvent.click(await screen.findByRole("button", { name: messages["ui.edit"] }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("Squalane (mol-base)")).toBeTruthy();
  const clear = dialog.querySelector(".ant-select-clear");
  expect(clear).toBeTruthy();
  fireEvent.mouseDown(clear!);
  fireEvent.click(within(dialog).getByRole("button", { name: messages["ui.save"] }));
  await waitFor(() => expect(api.updateBaseOil).toHaveBeenCalledWith("oil-1", expect.objectContaining({
    representativeMoleculeId: ""
  })));
});

it("allows a mixture base oil to be saved without a representative molecule", async () => {
  renderWithLanguage(<BaseAdditiveLibraryPage />);
  fireEvent.click(screen.getByRole("button", { name: messages["ui.newBaseOil"] }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(messages["ui.name"]), { target: { value: "Mixture" } });
  fireEvent.click(within(dialog).getByRole("button", { name: messages["ui.save"] }));
  await waitFor(() => expect(api.createBaseOil).toHaveBeenCalledWith(expect.objectContaining({ name: "Mixture" })));
  expect(api.createBaseOil.mock.calls[0][0].representativeMoleculeId).toBeUndefined();
});
