// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { SUPPORTED_LANGUAGES, type Language, type MessageKey } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

// Every page reaches the backend through this one module, so one mock covers all of them. The
// question here is not what the data is — it is whether the interface follows the language.
//
// The mock is built from the real API contract rather than hand-listed: a page that calls a
// function the mock forgot produces an unhandled rejection, which fails the run without failing
// any single test.
const apiMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  apiMock.value = createApiMock();
  return apiMock.value;
});

// Ketcher is a third-party bundle that draws onto a real canvas, which jsdom does not provide.
// What is under test here is the page's own text, so the editor is stood in for.
vi.mock("../features/molecule-sketcher/KetcherEditor", () => ({
  default: () => null
}));
import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";
import DashboardPage from "../features/dashboard/DashboardPage";
import DescriptorCenterPage from "../features/descriptors/DescriptorCenterPage";
import ExperimentPerformancePage from "../features/experiments/ExperimentPerformancePage";
import FormulationEntryPage from "../features/formulations/FormulationEntryPage";
import FormulationLibraryPage from "../features/formulations/FormulationLibraryPage";
import FormulationPredictionPage from "../features/data-mining/FormulationPredictionPage";
import ImportExportPage from "../features/import-export/ImportExportPage";
import MoleculeEntryPage from "../features/molecule-entry/MoleculeEntryPage";
import MoleculeLibraryPage from "../features/molecules/MoleculeLibraryPage";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import MoleculeSketcherPage from "../features/molecule-sketcher/MoleculeSketcherPage";
import SettingsPage from "../features/settings/SettingsPage";

/** Every routed page, with the key its heading renders. */
const ROUTES: { path: string; element: () => JSX.Element; titleKey: MessageKey }[] = [
  { path: "/dashboard", element: () => <DashboardPage />, titleKey: "ui.dashboard" },
  { path: "/molecules", element: () => <MoleculeLibraryPage />, titleKey: "molecule.libraryTitle" },
  { path: "/molecule-entry", element: () => <MoleculeEntryPage />, titleKey: "ui.moleculeEntry" },
  { path: "/descriptors", element: () => <DescriptorCenterPage />, titleKey: "ui.descriptorCenter" },
  { path: "/base-additive", element: () => <BaseAdditiveLibraryPage />, titleKey: "ui.baseOilsAdditives" },
  { path: "/formulations", element: () => <FormulationLibraryPage />, titleKey: "ui.formulationLibrary" },
  { path: "/formulations/new", element: () => <FormulationEntryPage />, titleKey: "ui.formulationEntry" },
  { path: "/experiments", element: () => <ExperimentPerformancePage />, titleKey: "ui.experimentsPerformance" },
  {
    path: "/data-mining/molecule-performance",
    element: () => <MoleculePerformancePredictionPage />,
    titleKey: "model.pageMoleculeTitle"
  },
  {
    path: "/data-mining/formulation-prediction",
    element: () => <FormulationPredictionPage />,
    titleKey: "model.pageFormulationTitle"
  },
  {
    path: "/molecule-sketcher",
    element: () => <MoleculeSketcherPage />,
    titleKey: "ui.moleculeDrawingAndSmilesGeneration"
  },
  { path: "/import-export", element: () => <ImportExportPage />, titleKey: "ui.importExport" },
  { path: "/settings", element: () => <SettingsPage />, titleKey: "settings.title" }
];

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("every route follows the selected language", () => {
  for (const route of ROUTES) {
    for (const language of SUPPORTED_LANGUAGES) {
      it(`${route.path} renders its heading in ${language}`, async () => {
        const expected = messagesForLanguage(language)[route.titleKey];
        expect(expected, `${route.titleKey} is missing from ${language}`).toBeTruthy();

        renderWithLanguage(route.element(), language);

        expect(await screen.findByRole("heading", { name: expected })).toBeTruthy();
      });
    }
  }

  it("shows a different heading in each language, so nothing is stuck in English", () => {
    const headings = new Set(
      SUPPORTED_LANGUAGES.map((language) => messagesForLanguage(language)["ui.dashboard"])
    );
    expect(headings.size).toBe(SUPPORTED_LANGUAGES.length);
  });
});

describe("the translation catalogue", () => {
  it("defines every key in every language", () => {
    const reference = messagesForLanguage("en-US");
    const keys = Object.keys(reference);
    expect(keys.length).toBeGreaterThan(500);
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = messagesForLanguage(language);
      const missing = keys.filter((key) => !messages[key]);
      expect(missing, `${language} is missing keys`).toEqual([]);
      const extra = Object.keys(messages).filter((key) => !(key in reference));
      expect(extra, `${language} has keys English does not`).toEqual([]);
    }
  });

  it("never leaves an English string in the Chinese or Japanese catalogue by accident", () => {
    // A key whose translation is byte-identical to the English is almost always a copy-paste
    // slip. The exceptions are genuine: names, units, and symbols that do not translate.
    const identical: Record<Language, string[]> = { "zh-CN": [], "en-US": [], "ja-JP": [] };
    const english = messagesForLanguage("en-US");
    for (const language of ["zh-CN", "ja-JP"] as Language[]) {
      const messages = messagesForLanguage(language);
      for (const [key, value] of Object.entries(english)) {
        // Anything containing kana or a CJK ideograph has clearly been translated.
        const translated = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(value);
        if (messages[key] === value && !translated) identical[language].push(key);
      }
    }
    const allowed = new Set([
      "app.nameChinese",
      "language.zh-CN",
      "language.en-US",
      "language.ja-JP",
      "label.rdkitMordred",
      "ui.rdkitMordred",
      // "ID" and "InChIKey" are identifiers, spelled the same in all three languages.
      "molecule.columnId",
      "ui.inchiKeyLabel"
    ]);
    for (const language of ["zh-CN", "ja-JP"] as Language[]) {
      const unexpected = identical[language].filter((key) => !allowed.has(key));
      expect(unexpected, `${language} repeats the English text for these keys`).toEqual([]);
    }
  });
});
