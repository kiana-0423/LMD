// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";
import { LanguageProvider } from "../i18n/LanguageContext";
import MainLayout from "../layouts/MainLayout";

const api = vi.hoisted(() => ({ listBaseOils: vi.fn(), listAdditives: vi.fn(), createBaseOil: vi.fn() }));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock(api);
});

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listBaseOils.mockResolvedValue([]);
  api.listAdditives.mockResolvedValue([]);
  api.createBaseOil.mockResolvedValue({});
});

function renderLibrary() {
  window.localStorage.setItem("lmd.language.v2", "zh-CN");
  return render(
    <LanguageProvider><MemoryRouter initialEntries={["/base-additive"]}>
      <Routes><Route element={<MainLayout />}>
        <Route path="/base-additive" element={<BaseAdditiveLibraryPage />} />
      </Route></Routes>
    </MemoryRouter></LanguageProvider>
  );
}

it("shows every record with consecutive numbers and per-library totals, including records beyond the old first page", async () => {
  const oils = Array.from({ length: 26 }, (_, index) => ({ id: `oil-${index}`, name: `Oil ${index}`, baseOilType: "PAO" }));
  const additives = Array.from({ length: 31 }, (_, index) => ({
    id: `add-${index}`, moleculeId: `mol-${index}`, moleculeName: `Additive ${index}`,
    functionTypes: ["antiwear", "extreme_pressure", "friction_modifier"]
  }));
  api.listBaseOils.mockResolvedValue(oils);
  api.listAdditives.mockResolvedValue(additives);
  const { container } = renderLibrary();

  await screen.findByRole("tab", { name: "基础油 (共 26 个)" }, { timeout: 5_000 });
  expect(screen.getByRole("tab", { name: "添加剂 (共 31 个)" })).toBeTruthy();
  expect(container.querySelector(".workspace-fixed-panel .base-additive-page")).toBeTruthy();
  expect(container.querySelector(".paged-content")).toBeNull();
  expect(container.querySelector(".ant-pagination")).toBeNull();
  const oilPanel = screen.getByRole("tabpanel");
  expect(within(oilPanel).getByRole("columnheader", { name: "编号" })).toBeTruthy();
  expect(oilPanel.querySelectorAll(".ant-table-row")).toHaveLength(26);
  expect(Array.from(oilPanel.querySelectorAll(".ant-table-row"), row => row.querySelector("td")?.textContent))
    .toEqual(oils.map((_, index) => String(index + 1)));
  expect(within(oilPanel).getByText("Oil 25")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "添加剂 (共 31 个)" }));
  const additivePanel = screen.getByRole("tabpanel");
  expect(additivePanel.querySelectorAll(".ant-table-row")).toHaveLength(31);
  expect(Array.from(additivePanel.querySelectorAll(".ant-table-row"), row => row.querySelector("td")?.textContent))
    .toEqual(additives.map((_, index) => String(index + 1)));
  expect(within(additivePanel).getByText("Additive 30")).toBeTruthy();
  expect(container.querySelector(".ant-pagination")).toBeNull();

  // A saved record must update both the displayed total and its last row number.
  api.listBaseOils.mockResolvedValue([...oils, { ...oils[0], id: "new-oil", name: "新增基础油" }]);
  fireEvent.click(screen.getByRole("button", { name: "新建基础油" }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("名称"), { target: { value: "新增基础油" } });
  fireEvent.click(dialog.getByRole("button", { name: /保\s*存/ }));
  await screen.findByRole("tab", { name: "基础油 (共 27 个)" }, { timeout: 5_000 });
  await waitFor(() => expect(api.createBaseOil).toHaveBeenCalledWith(expect.objectContaining({ name: "新增基础油" })));
  const lastRow = screen.getByRole("tabpanel").querySelector('[data-row-key="new-oil"]')!;
  expect(lastRow.querySelector("td")?.textContent).toBe("27");
  expect(within(lastRow as HTMLElement).getByText("新增基础油")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "添加剂 (共 31 个)" })).toBeTruthy();
});

it("shows zero totals for empty libraries without adding a numbered data row or pager", async () => {
  const { container } = renderLibrary();
  await screen.findByRole("tab", { name: "基础油 (共 0 个)" });
  fireEvent.click(screen.getByRole("tab", { name: "添加剂 (共 0 个)" }));
  expect(container.querySelector(".ant-table-row")).toBeNull();
  expect(container.querySelector(".ant-pagination")).toBeNull();
});
