// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import DashboardPage from "../features/dashboard/DashboardPage";
import KetcherTranslationBridge from "../features/molecule-sketcher/KetcherTranslationBridge";
import { LanguageProvider } from "../i18n/LanguageContext";
import { renderWithLanguage } from "./renderWithLanguage";
import MainLayout from "../layouts/MainLayout";

// Built from the real API contract, so a component that calls a function this test never thought
// about gets a working stub instead of an unhandled rejection.
const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

const summary = {
  moleculeCount: 1,
  baseOilCount: 2,
  additiveCount: 3,
  formulationCount: 4,
  formulationComponentCount: 0,
  experimentCount: 5,
  performanceResultCount: 0,
  attachmentCount: 0,
  dataSourceCount: 0,
  jobCount: 0,
  runningJobCount: 0,
  failedJobCount: 0,
  descriptorRecordCount: 2,
  descriptorReadyCount: 1,
  descriptorFailedCount: 0,
  descriptorPendingCount: 0,
  descriptorMockCount: 0,
  descriptorRealCount: 2
};

describe("DashboardPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMock.getDashboardSummary.mockReset();
    apiMock.listMoleculePage.mockReset();
  });

  it("shows a loading skeleton while requests are pending", () => {
    apiMock.getDashboardSummary.mockReturnValue(new Promise(() => undefined));
    apiMock.listMoleculePage.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithLanguage(<DashboardPage />);
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("shows an error card and retry action when loading fails", async () => {
    apiMock.getDashboardSummary.mockRejectedValueOnce(
      new Error("[record.notFound] database unavailable")
    );
    apiMock.listMoleculePage.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 8 });
    renderWithLanguage(<DashboardPage />);
    expect(await screen.findByText("Failed to load the dashboard")).toBeTruthy();
    // The code becomes a translated sentence; the diagnostic behind it survives word for word,
    // and the bracketed code itself never reaches the screen.
    expect(screen.getByText(/That record is not in the database\./)).toBeTruthy();
    expect(screen.getByText(/database unavailable/)).toBeTruthy();
    expect(screen.queryByText(/\[record\.notFound\]/)).toBeNull();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("keeps summary cards without molecule health or job status", async () => {
    apiMock.getDashboardSummary.mockResolvedValueOnce(summary);
    renderWithLanguage(<DashboardPage />);
    expect(await screen.findByText("Database Records")).toBeTruthy();
    expect(screen.getByText("Descriptor Status")).toBeTruthy();
    expect(screen.queryByText("Descriptor Health")).toBeNull();
    expect(screen.queryByText("Job Status")).toBeNull();
    expect(apiMock.listMoleculePage).not.toHaveBeenCalled();
  });

  it("keeps the dashboard in a single workspace without pagination", async () => {
    window.localStorage.setItem("lmd.language.v2", "en-US");
    apiMock.getDashboardSummary.mockResolvedValueOnce(summary);
    const { container } = render(
      <LanguageProvider><MemoryRouter initialEntries={["/dashboard"]}>
        <Routes><Route element={<MainLayout />}><Route path="/dashboard" element={<DashboardPage />} /></Route></Routes>
      </MemoryRouter></LanguageProvider>
    );
    await waitFor(() => expect(screen.getByText("Database Records")).toBeTruthy());
    expect(container.querySelector(".workspace-fixed-panel .dashboard-page")).toBeTruthy();
    expect(container.querySelector(".paged-content")).toBeNull();
    expect(container.querySelector(".stats-grid")?.children).toHaveLength(8);
    expect(container.querySelector(".dashboard-page .two-column-grid")?.children).toHaveLength(2);
  });

  it("renders the dashboard in the saved Chinese language", async () => {
    window.localStorage.setItem("lmd.language.v2", "zh-CN");
    apiMock.getDashboardSummary.mockResolvedValueOnce(summary);
    apiMock.listMoleculePage.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 8 });
    render(
      <LanguageProvider>
        <KetcherTranslationBridge />
        <DashboardPage />
      </LanguageProvider>
    );
    expect(await screen.findByRole("heading", { name: "仪表盘" })).toBeTruthy();
    expect(screen.getByText("从本地 SQLite 工作区实时汇总分子、描述符、配方、实验和文件记录。")).toBeTruthy();
    expect(screen.getByText("数据库记录")).toBeTruthy();
  });
});
