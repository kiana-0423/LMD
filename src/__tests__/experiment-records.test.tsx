// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ExperimentPerformancePage from "../features/experiments/ExperimentPerformancePage";
import ExperimentDetailModal from "../features/experiments/ExperimentDetailModal";
import FormulationLibraryPage from "../features/formulations/FormulationLibraryPage";
import { renderWithLanguage } from "./renderWithLanguage";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(api, createApiMock());
  return api;
});

const experiment = {
  id: "exp-1",
  formulationId: "blend-1",
  formulationName: "Trial blend",
  testType: "TGA",
  instrument: "Stored instrument",
  operator: "Researcher",
  experimentDate: "2026-09-27",
  notes: "Stored notes",
  createdAt: "2026-09-28",
  updatedAt: "2026-09-28"
};
const result = {
  id: "result-1",
  experimentId: "exp-1",
  initialDecompositionTemperatureValue: 312.5,
  repeatCount: 2,
  notes: "",
  createdAt: "2026-09-28",
  updatedAt: "2026-09-28"
};
const stored = { experiment, experiments: [], results: [result] };
const page = { items: [experiment], total: 1, page: 1, pageSize: 10, hasMore: false };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.searchFormulations.mockResolvedValue([{ id: "blend-1", label: "Trial blend" }]);
  api.listExperimentPage.mockResolvedValue(page);
  api.saveExperimentWithPerformance.mockResolvedValue({ experiment, result });
  api.getExperimentWithResults.mockResolvedValue(stored);
  api.updateExperimentRecord.mockResolvedValue(experiment);
  api.listFormulationPage.mockResolvedValue({
    ...page,
    items: [{ id: "blend-1", name: "Trial blend", components: [] }]
  });
  api.listFormulationExperiments.mockResolvedValue({ experiments: [experiment], results: [result] });
});

it("opens the persisted experiment and measurements after saving, then finds them in history", async () => {
  renderWithLanguage(<ExperimentPerformancePage />);
  fireEvent.mouseDown(await screen.findByLabelText("Formulation"));
  fireEvent.click(await screen.findByTitle("Trial blend"));
  fireEvent.mouseDown(screen.getByLabelText("Test Type"));
  fireEvent.click(await screen.findByTitle("TGA"));
  fireEvent.click(screen.getByRole("tab", { name: "Performance results" }));
  fireEvent.change(screen.getByLabelText("Initial thermal decomposition temperature"), { target: { value: "312.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Experiment and Performance" }));

  const detail = await screen.findByRole("dialog", { name: "Entered Experimental Data" });
  expect(await within(detail).findByText("312.5 °C")).toBeTruthy();
  expect(within(detail).getByText("Stored instrument")).toBeTruthy();
  expect(api.saveExperimentWithPerformance).toHaveBeenCalledWith(
    expect.objectContaining({
      formulationId: "blend-1",
      testType: "TGA",
      initialDecompositionTemperatureValue: 312.5
    })
  );
  expect(api.getExperimentWithResults).toHaveBeenCalledWith("exp-1");

  fireEvent.click(within(detail).getByText("Close"));
  fireEvent.click(screen.getByRole("button", { name: "Experiment Records" }));
  const history = await screen.findByRole("dialog", { name: "Experiment Records" });
  fireEvent.click(await within(history).findByRole("button", { name: "View" }));
  expect(await screen.findByText("312.5 °C")).toBeTruthy();
  expect(api.getExperimentWithResults).toHaveBeenCalledTimes(2);
});

it("pages stored records and resets to page one for a new search", async () => {
  api.listExperimentPage.mockResolvedValue({ ...page, total: 21, hasMore: true });
  renderWithLanguage(<ExperimentPerformancePage />);
  fireEvent.click(screen.getByRole("button", { name: "Experiment Records" }));
  const history = await screen.findByRole("dialog", { name: "Experiment Records" });
  fireEvent.click(await within(history).findByTitle("2"));
  await waitFor(() => expect(api.listExperimentPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 10, search: "" }));
  fireEvent.change(within(history).getByLabelText("Search formulation names or test types"), {
    target: { value: "TGA" }
  });
  await waitFor(() =>
    expect(api.listExperimentPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: "TGA" })
  );
});

it("reports history load failures and retries instead of displaying an empty list", async () => {
  api.listExperimentPage.mockRejectedValueOnce(new Error("History unavailable"));
  renderWithLanguage(<ExperimentPerformancePage />);
  fireEvent.click(screen.getByRole("button", { name: "Experiment Records" }));
  expect(await screen.findByText("History unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("exp-1")).toBeTruthy();
});

it("retries a failed detail read and explicitly reports a missing record", async () => {
  api.getExperimentWithResults.mockRejectedValueOnce(new Error("Detail unavailable"));
  api.getExperimentWithResults.mockResolvedValueOnce({ experiments: [], results: [] });
  renderWithLanguage(<ExperimentDetailModal experimentId="exp-1" onClose={vi.fn()} />);
  expect(await screen.findByText("Detail unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("This experiment was not found. It may have been deleted.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
});

it("lets the user view and correct another performance result, then reloads persisted values", async () => {
  const secondResult = { ...result, id: "result-2", initialDecompositionTemperatureValue: 325 };
  api.getExperimentWithResults.mockResolvedValue({ ...stored, results: [result, secondResult] });
  const onUpdated = vi.fn();
  renderWithLanguage(<ExperimentDetailModal experimentId="exp-1" onClose={vi.fn()} onUpdated={onUpdated} />);
  expect(await screen.findByText("312.5 °C")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Performance Results" }));
  fireEvent.click(await screen.findByTitle("2026-09-28 · result-2"));
  expect(await screen.findByText("325 °C")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Correct" }));
  fireEvent.click(screen.getByRole("tab", { name: "Performance results" }));
  fireEvent.change(screen.getByLabelText("Initial thermal decomposition temperature"), { target: { value: "330" } });
  api.getExperimentWithResults.mockResolvedValue({
    ...stored,
    results: [result, { ...secondResult, initialDecompositionTemperatureValue: 330 }]
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Correction" }));
  await waitFor(() =>
    expect(api.updateExperimentRecord).toHaveBeenCalledWith(
      "exp-1",
      expect.objectContaining({
        performanceResultId: "result-2",
        initialDecompositionTemperatureValue: 330
      })
    )
  );
  expect(await screen.findByText("330 °C")).toBeTruthy();
  expect(onUpdated).toHaveBeenCalledOnce();
});

it("opens the same stored details from the formulation library", async () => {
  renderWithLanguage(<FormulationLibraryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Experimental Data" }));
  const experiments = await screen.findByRole("dialog", { name: "Trial blend · Experimental Data" });
  fireEvent.click(await within(experiments).findByRole("button", { name: "View" }));
  expect(await screen.findByText("312.5 °C")).toBeTruthy();
  expect(api.getExperimentWithResults).toHaveBeenCalledWith("exp-1");
});

it("shows and retries experiment-list errors in the formulation library", async () => {
  api.listFormulationExperiments.mockRejectedValueOnce(new Error("Formulation experiments unavailable"));
  renderWithLanguage(<FormulationLibraryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Experimental Data" }));
  expect(await screen.findByText("Formulation experiments unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("exp-1")).toBeTruthy();
});
