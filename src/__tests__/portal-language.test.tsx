// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { type Language } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

// Ant Design renders drawers, modals and select dropdowns into a portal at the end of <body>,
// outside the React subtree the page occupies. A translation approach that walked the page tree
// would leave those in English; these check they follow the language too.
//
// The mock covers the whole API surface, not just the calls these tests care about: the base-oil
// modal contains a `MoleculePicker`, which searches the library on mount, and a mock missing that
// one function turns into an unhandled rejection that fails the run without failing a test.
const apiMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  apiMock.value = createApiMock();
  return apiMock.value;
});

import BaseAdditiveLibraryPage from "../features/base-additive/BaseAdditiveLibraryPage";
import MoleculeDetailDrawer from "../features/molecules/MoleculeDetailDrawer";
import type { Molecule } from "../types";

const molecule = {
  id: "mol-1",
  name: "Ethanol",
  aliases: "",
  smilesRaw: "CCO",
  smilesCanonical: "CCO",
  inchi: "",
  inchiKey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
  formula: "C2H6O",
  molecularWeight: 46.07,
  category: "candidate",
  additiveFunctionTags: [],
  molFilePath: "",
  sdfFilePath: "",
  pdbFilePath: "",
  structureSvg: "",
  molBlock: "",
  sdfBlock: "",
  pdbBlock: "",
  rdkitDescriptorStatus: "calculated",
  mordredDescriptorStatus: "calculated",
  descriptorReady: true,
  descriptorCount: 2,
  duplicateOf: "",
  importMode: "manual_save",
  source: "smiles_input",
  dataSource: "",
  notes: "",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
} as unknown as Molecule;

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe("drawer content follows the language", () => {
  for (const language of ["zh-CN", "ja-JP"] as Language[]) {
    it(`translates the molecule detail drawer tabs in ${language}`, async () => {
      const messages = messagesForLanguage(language);

      renderWithLanguage(
        <MoleculeDetailDrawer molecule={molecule} open onClose={() => {}} />,
        language
      );

      // The drawer is a portal: these nodes are not inside the rendered subtree.
      expect(await screen.findByText(messages["molecule.tabOverview"])).toBeTruthy();
      expect(screen.getByText(messages["molecule.tab3d"])).toBeTruthy();
      expect(screen.getByText(messages["molecule.tabFiles"])).toBeTruthy();
      // A molecule name is data, and must read the same in every language.
      expect(screen.getAllByText("Ethanol").length).toBeGreaterThan(0);
    });
  }
});

describe("modal content follows the language", () => {
  for (const language of ["zh-CN", "ja-JP"] as Language[]) {
    it(`translates the new base oil modal in ${language}`, async () => {
      const messages = messagesForLanguage(language);

      renderWithLanguage(<BaseAdditiveLibraryPage />, language);
      fireEvent.click(await screen.findByRole("button", { name: messages["ui.newBaseOil"] }));

      await waitFor(() => {
        // The modal title, its form labels, and its footer buttons are all in the portal.
        expect(screen.getAllByText(messages["ui.newBaseOil"]).length).toBeGreaterThan(1);
      });
      expect(screen.getByText(messages["ui.baseOilType"])).toBeTruthy();
      const footer = document.querySelector(".ant-modal-footer");
      expect(footer, "the modal renders a footer").toBeTruthy();
      // Ant Design inserts a space between two CJK characters in a button ("保 存"), so the
      // comparison ignores whitespace rather than the wording.
      const footerText = (footer?.textContent ?? "").replace(/\s+/g, "");
      expect(footerText).toContain(messages["ui.save"].replace(/\s+/g, ""));
      expect(footerText).toContain(messages["ui.cancel"].replace(/\s+/g, ""));
    });
  }
});
