// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { SUPPORTED_LANGUAGES, type Language } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

// The sketcher's own API adapter, separate from `lib/api`.
const sketcherMock = vi.hoisted(() => ({
  validateSketcherSmiles: vi.fn(),
  molfileToSmiles: vi.fn(),
  smilesToMolfile: vi.fn(),
  calculateSketcherDescriptors: vi.fn(),
  importNewMolecule: vi.fn(),
  checkMoleculeDuplicate: vi.fn()
}));
vi.mock("../lib/moleculeSketcherApi", () => sketcherMock);

// Ketcher draws onto a real canvas, which jsdom does not provide. The page's own text is what is
// under test, and the DOM translation bridge covers Ketcher's chrome separately.
vi.mock("../features/molecule-sketcher/KetcherEditor", () => ({
  default: () => null
}));

import MoleculeSketcherPage from "../features/molecule-sketcher/MoleculeSketcherPage";

beforeEach(async () => {
  window.localStorage.clear();
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  Object.values(sketcherMock).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  cleanup();
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

describe("the molecule sketcher follows the language", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    it(`renders its heading and initial status in ${language}`, async () => {
      const messages = messagesForLanguage(language);

      renderWithLanguage(<MoleculeSketcherPage />, language);

      expect(
        await screen.findByRole("heading", {
          name: messages["ui.moleculeDrawingAndSmilesGeneration"]
        })
      ).toBeTruthy();
      // The save status starts at "not saved" and is held as a key, so it follows the language.
      expect(screen.getByText(messages["sketcher.notSaved"])).toBeTruthy();
    });
  }

  for (const language of ["zh-CN", "ja-JP"] as Language[]) {
    it(`translates the status after a successful validation in ${language}`, async () => {
      const messages = messagesForLanguage(language);
      sketcherMock.validateSketcherSmiles.mockResolvedValue({
        valid: true,
        canonicalSmiles: "CCO",
        smilesCanonical: "CCO",
        formula: "C2H6O",
        molecularWeight: 46.07,
        inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"
      });

      renderWithLanguage(<MoleculeSketcherPage />, language);
      fireEvent.change(screen.getByRole("textbox", { name: messages["ui.smilesInput"] }), {
        target: { value: "CCO" }
      });
      fireEvent.click(screen.getByRole("button", { name: messages["ui.generateSmiles"] }));

      expect(await screen.findByText(messages["sketcher.canonicalGenerated"])).toBeTruthy();
    });

    it(`translates a refusal while keeping its detail in ${language}`, async () => {
      const messages = messagesForLanguage(language);
      sketcherMock.validateSketcherSmiles.mockResolvedValue({
        valid: false,
        error: "RDKit could not parse 'XYZ'",
        canonicalSmiles: "",
        smilesCanonical: "",
        formula: "",
        molecularWeight: 0,
        inchiKey: ""
      });

      renderWithLanguage(<MoleculeSketcherPage />, language);
      fireEvent.change(screen.getByRole("textbox", { name: messages["ui.smilesInput"] }), {
        target: { value: "XYZ" }
      });
      fireEvent.click(screen.getByRole("button", { name: messages["ui.generateSmiles"] }));

      // The situation is translated…
      expect(await screen.findByText(messages["error.sketcherInvalidSmiles"])).toBeTruthy();
      // …and the diagnostic the sidecar produced survives untouched.
      expect(screen.getByText("RDKit could not parse 'XYZ'")).toBeTruthy();
    });
  }

  it("refuses an empty structure with a translated message", async () => {
    const messages = messagesForLanguage("ja-JP");

    renderWithLanguage(<MoleculeSketcherPage />, "ja-JP");
    fireEvent.click(screen.getByRole("button", { name: messages["ui.generateSmiles"] }));

    await waitFor(() =>
      expect(screen.getByText(messages["error.sketcherNeedsStructure"])).toBeTruthy()
    );
    expect(sketcherMock.validateSketcherSmiles).not.toHaveBeenCalled();
  });
});
