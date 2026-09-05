// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PagedContent from "../components/PagedContent";
import WorkspaceTabs from "../components/WorkspaceTabs";
import { paginateWorkspace } from "../lib/workspacePagination";
import { renderWithLanguage } from "./renderWithLanguage";

afterEach(() => vi.restoreAllMocks());

describe("workspace page boundaries", () => {
  it("moves a complete table row or form field to the next page", () => {
    const rows = [{ start: 250, end: 330 }, { start: 550, end: 630 }];
    const pages = paginateWorkspace(800, 300, rows);
    expect(pages).toEqual([{ start: 0, end: 250 }, { start: 250, end: 550 }, { start: 550, end: 800 }]);
    for (const page of pages) {
      expect(rows.some((row) => row.start < page.end && row.end > page.end)).toBe(false);
    }
  });

  it("reaches the final content without gaps when the window is shorter", () => {
    const pages = paginateWorkspace(1400, 180, []);
    expect(pages[0].start).toBe(0);
    expect(pages[pages.length - 1]?.end).toBe(1400);
    pages.forEach((page, index) => {
      expect(page.end - page.start).toBeLessThanOrEqual(180);
      if (index) expect(page.start).toBe(pages[index - 1].end);
    });
  });

  it("terminates even for an oversized block and zero-size hidden tabs", () => {
    expect(paginateWorkspace(900, 300, [{ start: 0, end: 900 }])).toHaveLength(3);
    expect(paginateWorkspace(0, 0, [])).toEqual([{ start: 0, end: 0 }]);
  });
});

it("keeps edits on page changes, reveals a keyboard-focused field, and refits after resize", async () => {
  let viewportHeight = 400;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("paged-content") ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("paged-flow")) return new DOMRect(0, 0, 800, 900);
    return new DOMRect(0, Number(this.dataset.top ?? 0), 200, 32);
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
  renderWithLanguage(
    <PagedContent>
      <input aria-label="First field" data-top="20" defaultValue="" />
      <input aria-label="Last field" data-top="800" defaultValue="" />
    </PagedContent>
  );
  const first = screen.getByRole("textbox", { name: "First field" });
  fireEvent.change(first, { target: { value: "Unsubmitted edit" } });
  expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  fireEvent.focus(screen.getByRole("textbox", { name: "Last field" }));
  expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect((first as HTMLInputElement).value).toBe("Unsubmitted edit");
  viewportHeight = 1000;
  fireEvent(window, new Event("resize"));
  await waitFor(() => expect(screen.queryByRole("navigation")).toBeNull());
  expect(document.querySelector<HTMLElement>(".paged-flow")?.style.transform).toBe("translateY(-0px)");
  expect((first as HTMLInputElement).value).toBe("Unsubmitted edit");
});

it("keeps unsaved form state when switching between task tabs", async () => {
  renderWithLanguage(
    <WorkspaceTabs labels={["Design", "Results"]}>
      <input aria-label="Draft name" defaultValue="" />
      <div>Candidate results</div>
    </WorkspaceTabs>
  );
  fireEvent.change(await screen.findByRole("textbox", { name: "Draft name" }), { target: { value: "Phosphate series" } });
  fireEvent.click(screen.getByRole("tab", { name: "Results" }));
  expect(screen.queryByRole("textbox", { name: "Draft name" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Design" }));
  expect((screen.getByRole("textbox", { name: "Draft name" }) as HTMLInputElement).value).toBe("Phosphate series");
});
