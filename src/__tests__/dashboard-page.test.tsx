// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import DashboardPage from "../features/dashboard/DashboardPage";

const apiMock = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  listMolecules: vi.fn()
}));

vi.mock("../lib/api", () => apiMock);

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
    apiMock.getDashboardSummary.mockReset();
    apiMock.listMolecules.mockReset();
  });

  it("shows a loading skeleton while requests are pending", () => {
    apiMock.getDashboardSummary.mockReturnValue(new Promise(() => undefined));
    apiMock.listMolecules.mockReturnValue(new Promise(() => undefined));
    const { container } = render(<DashboardPage />);
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("shows an error card and retry action when loading fails", async () => {
    apiMock.getDashboardSummary.mockRejectedValueOnce(new Error("database unavailable"));
    apiMock.listMolecules.mockResolvedValueOnce([]);
    render(<DashboardPage />);
    expect(await screen.findByText("仪表盘加载失败")).toBeTruthy();
    expect(screen.getByText("database unavailable")).toBeTruthy();
    expect(screen.getByText("重 试")).toBeTruthy();
  });

  it("shows an empty molecule health state", async () => {
    apiMock.getDashboardSummary.mockResolvedValueOnce(summary);
    apiMock.listMolecules.mockResolvedValueOnce([]);
    render(<DashboardPage />);
    expect(await screen.findByText("数据库中暂无分子记录。")).toBeTruthy();
  });

  it("renders loaded dashboard metrics and molecule health", async () => {
    apiMock.getDashboardSummary.mockResolvedValueOnce(summary);
    apiMock.listMolecules.mockResolvedValueOnce([
      { id: "mol-1", name: "Ethanol", smilesCanonical: "CCO", descriptorReady: true }
    ]);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText("Ethanol")).toBeTruthy());
    expect(screen.getByText("CCO")).toBeTruthy();
    expect(screen.getByText("就绪")).toBeTruthy();
  });
});
