// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import AppRoutes from "../routes/AppRoutes";
import { formalRoutes } from "../lib/constants";
import { renderWithLanguage } from "./renderWithLanguage";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import FormulationPredictionPage from "../features/data-mining/FormulationPredictionPage";
import { messagesForLanguage } from "../i18n/catalogues";
import routes from "../routes/AppRoutes?raw";
import layout from "../layouts/MainLayout?raw";

const api = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(api, createApiMock());
  return api;
});
const en = messagesForLanguage("en-US");
afterEach(cleanup);

it("opens formulation entry from the library and returns to the library", async () => {
  window.localStorage.clear();
  render(<MemoryRouter initialEntries={["/formulations"]}><LanguageProvider><AppRoutes /></LanguageProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: en["formulation.create"] }));
  expect(await screen.findByRole("button", { name: en["ui.saveFormulation"] })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en["formulation.backToLibrary"] }));
  expect(await screen.findByRole("button", { name: en["formulation.create"] })).toBeTruthy();
});

it("keeps old entry bookmarks working without a standalone menu item", async () => {
  window.localStorage.clear();
  render(<MemoryRouter initialEntries={["/formulation-entry"]}><LanguageProvider><AppRoutes /></LanguageProvider></MemoryRouter>);
  expect(await screen.findByRole("button", { name: en["formulation.backToLibrary"] })).toBeTruthy();
  expect(formalRoutes.some(({ key }) => String(key) === "/formulation-entry")).toBe(false);
});

it("does not load or expose retired analysis and screening pages", () => {
  expect(routes).not.toContain("AnalysisDesignPage");
  expect(routes).not.toContain("MoleculeScreeningPage");
  expect(layout).not.toContain('key: "/analysis"');
  expect(layout).not.toContain('key: "/data-mining/molecule-screening"');
});

it("starts molecule prediction at extreme pressure with single-additive training", async () => {
  api.listModels.mockClear();
  renderWithLanguage(<MoleculePerformancePredictionPage />);
  await waitFor(() => expect(api.listModels).toHaveBeenCalledWith("extreme_pressure_value", "additive_component"));
  expect(screen.getByText(en["model.scopeSingleAdditiveOnly"])).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: en["model.scopeSingleAdditiveOnly"] })).toBeNull();
});

it("starts whole-formulation prediction at friction coefficient", async () => {
  api.listModels.mockClear();
  renderWithLanguage(<FormulationPredictionPage />);
  await waitFor(() => expect(api.listModels).toHaveBeenCalledWith("average_friction_coefficient", "formulation_aggregate"));
});
