// @vitest-environment jsdom

import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { LanguageProvider, SUPPORTED_LANGUAGES, type Language } from "../i18n/LanguageContext";

export const LANGUAGE_STORAGE_KEY = "lmd.language.v2";

/**
 * Renders a page the way the application does: inside the language provider and a router.
 *
 * The provider reads the saved language on mount, so the language is set through storage rather
 * than a prop — the same path a returning user takes.
 */
// A test helper, not a component module; the fast-refresh rule does not apply to it.
// eslint-disable-next-line react-refresh/only-export-components
export function renderWithLanguage(ui: ReactNode, language: Language = "en-US"): RenderResult {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return render(
    <LanguageProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </LanguageProvider>
  );
}

export const LANGUAGES = SUPPORTED_LANGUAGES;
