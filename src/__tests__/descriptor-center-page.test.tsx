// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DescriptorCenterPage from "../features/descriptors/DescriptorCenterPage";
import { renderWithLanguage } from "./renderWithLanguage";

// Built from the real API contract, so a component that calls a function this test never thought
// about gets a working stub instead of an unhandled rejection.
const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

describe("DescriptorCenterPage", () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear());
    apiMock.listMoleculePage.mockResolvedValue({
      items: [{ id: "mol-1", name: "ZDDP-Chain-Ester-01" }],
      total: 500,
      page: 1,
      pageSize: 7
    });
    apiMock.listDescriptorJobs.mockResolvedValue([]);
    apiMock.listDescriptorsForMolecules.mockResolvedValue([
      { moleculeId: "mol-1", descriptorSet: "rdkit", status: "calculated", mode: "real", descriptorCount: 210 },
      { moleculeId: "mol-1", descriptorSet: "mordred", status: "calculated", mode: "real", descriptorCount: 1800 }
    ]);
  });

  it("requests a single page instead of the whole library", async () => {
    renderWithLanguage(<DescriptorCenterPage />);

    await waitFor(() => expect(screen.getByText("ZDDP-Chain-Ester-01")).toBeTruthy());
    expect(apiMock.listMoleculePage).toHaveBeenCalledTimes(1);
    expect(apiMock.listMoleculePage).toHaveBeenCalledWith({ page: 1, pageSize: 7 });
  });

  it("reads the whole page's descriptor status in one call, without the values", async () => {
    renderWithLanguage(<DescriptorCenterPage />);

    await waitFor(() => expect(apiMock.listDescriptorsForMolecules).toHaveBeenCalled());
    // One call naming the page's molecules, not one call per row — and no second argument, which
    // would opt into the ~1,800-value Mordred blob for every one of them.
    expect(apiMock.listDescriptorsForMolecules).toHaveBeenCalledTimes(1);
    expect(apiMock.listDescriptorsForMolecules).toHaveBeenCalledWith(["mol-1"]);
    expect(screen.getByText("2010")).toBeTruthy();
  });

  it("recalculates through the server-side command without enumerating ids", async () => {
    renderWithLanguage(<DescriptorCenterPage />);
    await waitFor(() => expect(screen.getByText("ZDDP-Chain-Ester-01")).toBeTruthy());

    screen.getByRole("button", { name: "Recalculate All" }).click();

    await waitFor(() => expect(apiMock.recalculateAllDescriptors).toHaveBeenCalledWith());
  });
});

describe("descriptor job history", () => {
  it("shows recorded batches from the jobs table", async () => {
    apiMock.listDescriptorJobs.mockResolvedValue([
      {
        id: "job-1",
        jobType: "descriptor_batch",
        status: "failed",
        progress: 1,
        totalCount: 12,
        successCount: 8,
        failedCount: 4,
        errorMessage: "The packaged sidecar timed out after 300 seconds.",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-01T09:05:00Z"
      }
    ]);

    renderWithLanguage(<DescriptorCenterPage />);

    await waitFor(() => expect(screen.getByText(/timed out/)).toBeTruthy());
    expect(apiMock.listDescriptorJobs).toHaveBeenCalledWith(10);
    // Counts come from the job row, not from a fabricated summary.
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("says plainly when no batch has run", async () => {
    apiMock.listDescriptorJobs.mockResolvedValue([]);

    renderWithLanguage(<DescriptorCenterPage />);

    await waitFor(() =>
      expect(screen.getByText("No descriptor batch has been run in this workspace yet.")).toBeTruthy()
    );
  });
});
