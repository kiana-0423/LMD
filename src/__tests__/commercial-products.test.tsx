// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { message } from "antd";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CommercialProductLibraryPage from "../features/commercial-products/CommercialProductLibraryPage";
import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";
import { renderWithLanguage } from "./renderWithLanguage";
import type { CommercialProduct } from "../lib/api";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(api, createApiMock());
  return api;
});
const product: CommercialProduct = {
  id: "p-1",
  name: "Commercial AW-1",
  category: "additive",
  generalFormula: "R–S–R",
  manufacturer: "Example manufacturer",
  productionDate: "2026-09-01",
  batchNumber: "001",
  productNumber: "00042",
  supplier: "Example supplier",
  notes: "Batch record",
  createdAt: "2026-09-08",
  updatedAt: "2026-09-08"
};
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 10, hasMore: false });
beforeEach(() => {
  vi.clearAllMocks();
  api.listCommercialProductPage.mockResolvedValue(page([product]));
  api.saveCommercialProduct.mockResolvedValue(product);
  api.listBaseOilPage.mockResolvedValue(page([]));
  api.listAdditivePage.mockResolvedValue(page([]));
});
afterEach(() => {
  cleanup();
  message.destroy();
});

it("records manufacturer, date, batch, leading-zero number and optional formula without a structure field", async () => {
  renderWithLanguage(<CommercialProductLibraryPage />);
  fireEvent.click(screen.getByRole("button", { name: "New product" }));
  const dialog = within(screen.getByRole("dialog"));
  for (const [label, value] of [
    ["Product name / grade", product.name],
    ["Manufacturer", product.manufacturer],
    ["Production date", product.productionDate],
    ["Batch number", product.batchNumber],
    ["Product / catalogue number", product.productNumber],
    ["General formula (optional)", product.generalFormula]
  ])
    fireEvent.change(dialog.getByLabelText(label), { target: { value } });
  expect(dialog.queryByLabelText(/SMILES|Representative Molecule/i)).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.saveCommercialProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: product.name,
        manufacturer: product.manufacturer,
        productionDate: product.productionDate,
        batchNumber: "001",
        productNumber: "00042",
        generalFormula: product.generalFormula
      }),
      undefined
    )
  );
  expect(await screen.findByText("Product saved.")).toBeTruthy();
});

it("registers a product as an additive once and refreshes its registration status", async () => {
  api.registerCommercialProduct.mockResolvedValue({ ...product, additiveId: "a-1" });
  renderWithLanguage(<CommercialProductLibraryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  const button = await screen.findByRole("button", { name: "Add to additives" });
  api.listCommercialProductPage.mockResolvedValue(page([{ ...product, additiveId: "a-1" }]));
  fireEvent.click(button);
  await waitFor(() => expect(api.registerCommercialProduct).toHaveBeenCalledWith("p-1", "additive"));
  expect(await screen.findByRole("button", { name: "In additives" })).toBeDisabled();
  expect(api.createAdditive).not.toHaveBeenCalled();
});

it("keeps entered data available when saving fails", async () => {
  api.saveCommercialProduct.mockRejectedValueOnce(new Error("Storage unavailable"));
  renderWithLanguage(<CommercialProductLibraryPage />);
  fireEvent.click(screen.getByRole("button", { name: "New product" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Product name / grade"), { target: { value: "Unsaved product" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await screen.findByText(/Storage unavailable/);
  expect(dialog.getByLabelText("Product name / grade")).toHaveValue("Unsaved product");
});

it("edits a commercial additive's application fields without requiring a molecule", async () => {
  api.listAdditivePage.mockResolvedValue(
    page([
      {
        id: "a-1",
        moleculeId: "",
        moleculeName: product.name,
        commercialProductId: product.id,
        functionTypes: [],
        activeElements: [],
        typicalConcentrationMin: 0,
        typicalConcentrationMax: 0,
        concentrationUnit: "wt%",
        compatibleBaseOils: [],
        formulationCount: 0,
        applicationNotes: "",
        createdAt: "2026-09-08",
        updatedAt: "2026-09-08"
      }
    ])
  );
  renderWithLanguage(<BaseAdditiveLibraryPage />);
  fireEvent.click(await screen.findByRole("tab", { name: /Additives/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("link", { name: "View product batch" })).toHaveAttribute("href", "/products?id=p-1");
  expect(dialog.queryByRole("combobox", { name: "Representative Molecule" })).toBeNull();
  fireEvent.change(dialog.getByLabelText("Application Notes"), { target: { value: "Measured on batch 001" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.updateAdditive).toHaveBeenCalledWith(
      "a-1",
      expect.objectContaining({ applicationNotes: "Measured on batch 001" })
    )
  );
});

it("shows batch metadata and the sibling library in Chinese", async () => {
  renderWithLanguage(<CommercialProductLibraryPage />, "zh-CN");
  expect(await screen.findByRole("heading", { name: "成品库" })).toBeTruthy();
  expect(await screen.findByText(product.manufacturer)).toBeTruthy();
  expect(screen.getByText("00042")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "新增成品" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("厂家")).toBeTruthy();
  expect(dialog.getByLabelText("通式（可选）")).toBeTruthy();
});

it("saves manual properties and custom values across the product and properties tabs", async () => {
  renderWithLanguage(<CommercialProductLibraryPage />);
  fireEvent.click(screen.getByRole("button", { name: "New product" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Product name / grade"), { target: { value: "Manual material" } });
  fireEvent.click(dialog.getByRole("tab", { name: "Material properties" }));
  expect(dialog.getByLabelText("Density (g/cm³)")).toHaveValue("");
  fireEvent.change(dialog.getByLabelText("Kinematic viscosity at 40 °C (mm²/s)"), { target: { value: "46.5" } });
  fireEvent.change(dialog.getByLabelText("Density (g/cm³)"), { target: { value: "0.86" } });
  fireEvent.change(dialog.getByLabelText("Pour point (°C)"), { target: { value: "-42" } });
  fireEvent.click(dialog.getByRole("button", { name: "Add property" }));
  const custom = within(dialog.getByRole("group", { name: "Additional properties 1" }));
  fireEvent.change(custom.getByLabelText("Property name"), { target: { value: "Acid number" } });
  fireEvent.change(custom.getByLabelText("Value / description"), { target: { value: "0–0.1" } });
  fireEvent.change(custom.getByLabelText("Unit"), { target: { value: "mg KOH/g" } });
  fireEvent.change(custom.getByLabelText("Test conditions / source"), { target: { value: "Supplier certificate" } });
  fireEvent.click(dialog.getByRole("tab", { name: "Product & batch" }));
  expect(dialog.getByLabelText("Product name / grade")).toHaveValue("Manual material");
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.saveCommercialProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Manual material",
        materialProperties: expect.objectContaining({
          viscosity40c: 46.5,
          density: 0.86,
          pourPoint: -42,
          custom: [{ name: "Acid number", value: "0–0.1", unit: "mg KOH/g", conditions: "Supplier certificate" }]
        })
      }),
      undefined
    )
  );
  expect(api.recalculateAllDescriptors).not.toHaveBeenCalled();
});

it("shows manually recorded properties in details and permits clearing them", async () => {
  api.listCommercialProductPage.mockResolvedValue(
    page([
      {
        ...product,
        materialProperties: {
          density: 0.86,
          pourPoint: -42,
          custom: [{ name: "Acid number", value: "0", unit: "mg KOH/g", conditions: "Certificate" }]
        }
      }
    ])
  );
  renderWithLanguage(<CommercialProductLibraryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  const details = within(screen.getByRole("dialog"));
  expect(details.getByText("0.86")).toBeTruthy();
  expect(details.getByText("0 mg KOH/g")).toBeTruthy();
  fireEvent.click(details.getByRole("button", { name: "Edit" }));
  const editor = within((await screen.findByLabelText("Density (g/cm³)")).closest('[role="dialog"]') as HTMLElement);
  fireEvent.click(editor.getByRole("tab", { name: "Material properties" }));
  fireEvent.change(editor.getByLabelText("Density (g/cm³)"), { target: { value: "" } });
  fireEvent.click(editor.getByRole("button", { name: "Remove property" }));
  fireEvent.click(editor.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.saveCommercialProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        materialProperties: expect.objectContaining({ density: null, custom: [] })
      }),
      product.id
    )
  );
});
