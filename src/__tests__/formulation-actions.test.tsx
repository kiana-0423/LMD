// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import FormulationLibraryPage from "../features/formulations/FormulationLibraryPage";
import { LanguageProvider } from "../i18n/LanguageContext";

/** One page of formulations, in the shape `list_formulations_page` returns. */
function formulationPage(items: unknown[]) {
  return { items, total: items.length, page: 1, pageSize: 10, hasMore: false };
}


// Built from the real API contract, so a component that calls a function this test never thought
// about gets a working stub instead of an unhandled rejection.
const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

function formulation(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    baseOil: "PAO-6",
    additiveCount: 1,
    components: [
      {
        id: `${id}-c1`,
        formulationId: id,
        componentRole: "additive",
        additiveId: "add-1",
        concentrationValue: 1.0,
        concentrationUnit: "wt%"
      }
    ],
    componentsSummary: "PAO-6 + ZDDP",
    preparationMethod: "Stirred",
    preparationTemperature: 60,
    preparationTemperatureUnit: "C",
    preparationTime: 30,
    preparationTimeUnit: "min",
    stabilityObservation: "Stable",
    experimentCount: 2,
    bestAverageFrictionCoefficient: 0.082,
    bestWearScarDiameter: 410,
    highestOxidationTemperature: 250,
    bestExtremePressureValue: 640,
    notes: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra
  };
}

const ROWS = [
  formulation("f-1", "PAO-6 + ZDDP 1.0%"),
  // Distinct measurements so the comparison assertions cannot pass by coincidence.
  formulation("f-2", "PAO-8 + MoDTC 0.5%", {
    experimentCount: 5,
    bestAverageFrictionCoefficient: 0.071,
    bestWearScarDiameter: 355,
    highestOxidationTemperature: 262,
    bestExtremePressureValue: 780
  })
];

async function renderPage() {
  render(
    <LanguageProvider>
      <MemoryRouter><FormulationLibraryPage /></MemoryRouter>
    </LanguageProvider>
  );
  await waitFor(() => expect(screen.getByText("PAO-6 + ZDDP 1.0%")).toBeTruthy());
}

/** Selects a data row by its checkbox (the first checkbox is "select all"). */
function selectRow(index: number) {
  const checkboxes = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxes[index + 1]);
}

describe("FormulationLibraryPage actions", () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear());
    apiMock.listFormulationPage.mockResolvedValue(formulationPage(ROWS));
    apiMock.listExperiments.mockResolvedValue([]);
    apiMock.listPerformanceResults.mockResolvedValue([]);
  });

  it("disables Copy and Compare until the selection is valid", async () => {
    await renderPage();

    expect(screen.getByTestId("copy-formulation")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("compare-formulations")).toHaveProperty("disabled", true);

    selectRow(0);
    await waitFor(() => expect(screen.getByTestId("copy-formulation")).toHaveProperty("disabled", false));
    // One row is enough to copy but not to compare.
    expect(screen.getByTestId("compare-formulations")).toHaveProperty("disabled", true);

    selectRow(1);
    await waitFor(() => expect(screen.getByTestId("compare-formulations")).toHaveProperty("disabled", false));
    // Two rows is no longer a valid copy source.
    expect(screen.getByTestId("copy-formulation")).toHaveProperty("disabled", true);
  });

  it("copies the selected formulation through the backend and refreshes from the database", async () => {
    apiMock.copyFormulation.mockResolvedValue(formulation("f-3", "PAO-6 + ZDDP 1.0% Copy"));
    await renderPage();
    apiMock.listFormulationPage.mockClear();

    selectRow(0);
    fireEvent.click(screen.getByTestId("copy-formulation"));

    // The default name is derived from the source and can be edited before anything is written.
    const nameInput = await screen.findByTestId("copy-name");
    expect((nameInput as HTMLInputElement).value).toBe("PAO-6 + ZDDP 1.0% Copy");
    fireEvent.change(nameInput, { target: { value: "Trial batch B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create copy" }));

    await waitFor(() => expect(apiMock.copyFormulation).toHaveBeenCalledWith("f-1", "Trial batch B"));
    // The list is re-read from SQLite rather than patched locally.
    await waitFor(() => expect(apiMock.listFormulationPage).toHaveBeenCalled());
  });

  it("surfaces a copy failure instead of reporting success", async () => {
    apiMock.copyFormulation.mockRejectedValue(new Error("FOREIGN KEY constraint failed"));
    await renderPage();

    selectRow(0);
    fireEvent.click(screen.getByTestId("copy-formulation"));
    fireEvent.click(await screen.findByRole("button", { name: "Create copy" }));

    // The message now leads with a translated summary and keeps the backend detail after it.
    expect(await screen.findByText(/FOREIGN KEY constraint failed/)).toBeTruthy();
  });

  it("compares exactly the selected database rows", async () => {
    apiMock.compareFormulations.mockResolvedValue(ROWS);
    await renderPage();

    selectRow(0);
    selectRow(1);
    fireEvent.click(screen.getByTestId("compare-formulations"));

    await waitFor(() => expect(apiMock.compareFormulations).toHaveBeenCalledWith(["f-1", "f-2"]));

    const dialog = await screen.findByRole("dialog", { name: /Compare Formulations/ });
    // Values come from the compared records, including measured performance.
    expect(within(dialog).getByText("Best friction coefficient")).toBeTruthy();
    expect(within(dialog).getAllByText("0.082").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("0.071").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("640 N").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("780 N").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("PAO-8 + MoDTC 0.5%").length).toBeGreaterThan(0);
  });

  it("marks values that were never measured instead of inventing them", async () => {
    apiMock.compareFormulations.mockResolvedValue([
      ROWS[0],
      formulation("f-2", "Untested blend", {
        experimentCount: 0,
        bestAverageFrictionCoefficient: null,
        bestWearScarDiameter: null,
        highestOxidationTemperature: null,
        bestExtremePressureValue: null
      })
    ]);
    await renderPage();

    selectRow(0);
    selectRow(1);
    fireEvent.click(screen.getByTestId("compare-formulations"));

    const dialog = await screen.findByRole("dialog", { name: /Compare Formulations/ });
    expect(within(dialog).getAllByText("Not recorded").length).toBeGreaterThanOrEqual(4);
  });

  it("shows a comparison failure rather than an empty table", async () => {
    apiMock.compareFormulations.mockRejectedValue(new Error("These formulations are no longer in the database: f-2"));
    await renderPage();

    selectRow(0);
    selectRow(1);
    fireEvent.click(screen.getByTestId("compare-formulations"));

    expect(await screen.findByText(/no longer in the database/)).toBeTruthy();
  });
});
