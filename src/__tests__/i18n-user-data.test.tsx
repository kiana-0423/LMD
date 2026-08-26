// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import KetcherTranslationBridge from "../features/molecule-sketcher/KetcherTranslationBridge";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { ketcherPhraseCount, translateKetcherPhrase } from "../features/molecule-sketcher/ketcherPhrases";

/** Values that come from the user or from imported files and must survive every language. */
const USER_DATA = [
  "ZDDP-Chain-Ester-01",
  "CC(C)OP(=S)(OC(C)C)S",
  "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
  "C20H42BrNO2",
  "/Users/lab/imports/batch 2026.xlsx",
  "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3"
];

/** Database values that are character-for-character identical to UI dictionary phrases. */
const COLLIDING = ["Source", "Chain", "Additive", "Notes", "Failed", "Ready", "Export", "Status"];

function Harness() {
  const { setLanguage, t } = useLanguage();
  return (
    <>
      <KetcherTranslationBridge />
      <button type="button" onClick={() => setLanguage("zh-CN")}>
        zh
      </button>
      <button type="button" onClick={() => setLanguage("ja-JP")}>
        ja
      </button>
      <button type="button" onClick={() => setLanguage("en-US")}>
        en
      </button>
      {/* Application chrome comes from the key catalogue. */}
      <h1>{t("menu.settings")}</h1>
      <p data-testid="chrome">{t("menu.molecules")}</p>
      <p data-testid="files-title">{t("files.attachmentsTitle")}</p>
      <p data-testid="copy-title">{t("formulation.copyTitle")}</p>
      <p data-testid="usage-empty">{t("usage.empty")}</p>
      <p data-testid="viewer-empty">{t("viewer3d.emptyTitle")}</p>
      <p data-testid="model-title">{t("model.trainTitle")}</p>
      <p data-testid="screening-title">{t("screening.title")}</p>
      {/* Database values, marked as data. */}
      {[...USER_DATA, ...COLLIDING].map((value) => (
        <p key={value} translate="no" data-testid={`data-${value}`}>
          {value}
        </p>
      ))}
    </>
  );
}

async function switchTo(language: "zh" | "ja" | "en", expectedChrome: string) {
  fireEvent.click(screen.getByRole("button", { name: language }));
  await waitFor(() => expect(screen.getByTestId("chrome").textContent).toBe(expectedChrome));
}

describe("key-based internationalization", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches every migrated screen's labels immediately, without a reload", async () => {
    render(
      <LanguageProvider>
        <Harness />
      </LanguageProvider>
    );
    // English is the default.
    expect(screen.getByTestId("chrome").textContent).toBe("Molecule Library");
    expect(screen.getByTestId("files-title").textContent).toBe("Attachments");
    expect(screen.getByTestId("model-title").textContent).toBe("1. Train a local model");

    await switchTo("zh", "分子库");
    for (const id of [
      "files-title",
      "copy-title",
      "usage-empty",
      "viewer-empty",
      "model-title",
      "screening-title"
    ]) {
      const text = screen.getByTestId(id).textContent ?? "";
      // Nothing on a migrated screen may still read as English after switching.
      expect(text, `${id} should be translated`).not.toMatch(/^[\x20-\x7E]+$/);
    }

    await switchTo("ja", "分子ライブラリ");
    expect(screen.getByTestId("files-title").textContent).toBe("添付ファイル");
    expect(screen.getByTestId("screening-title").textContent).toBe("分子スクリーニング");

    await switchTo("en", "Molecule Library");
    expect(screen.getByTestId("files-title").textContent).toBe("Attachments");
  });

  it.each(["zh", "ja", "en"] as const)("never rewrites database values in %s", async (language) => {
    render(
      <LanguageProvider>
        <Harness />
      </LanguageProvider>
    );
    await switchTo(
      language,
      language === "zh" ? "分子库" : language === "ja" ? "分子ライブラリ" : "Molecule Library"
    );

    for (const value of [...USER_DATA, ...COLLIDING]) {
      expect(screen.getByTestId(`data-${value}`).textContent).toBe(value);
    }
  });
});

describe("KetcherTranslationBridge scope", () => {
  beforeEach(() => window.localStorage.clear());

  it("does nothing outside the Ketcher subtree", async () => {
    function OutsideHarness() {
      const { setLanguage } = useLanguage();
      return (
        <>
          <KetcherTranslationBridge />
          <button type="button" onClick={() => setLanguage("zh-CN")}>
            zh
          </button>
          {/* A Ketcher phrase rendered outside the editor: the bridge must leave it alone,
              because application text is expected to come from the key catalogue instead. */}
          <p data-testid="outside">Clear Canvas</p>
        </>
      );
    }
    render(
      <LanguageProvider>
        <OutsideHarness />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "zh" }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByTestId("outside").textContent).toBe("Clear Canvas");
  });

  it("translates the Ketcher subtree, which renders outside React", async () => {
    function KetcherHarness() {
      const { setLanguage } = useLanguage();
      return (
        <>
          <KetcherTranslationBridge />
          <button type="button" onClick={() => setLanguage("zh-CN")}>
            zh
          </button>
          <div data-i18n-ketcher>
            {/* A real Ketcher toolbar label. */}
            <span data-testid="ketcher-label">Clear Canvas</span>
            <span data-testid="ketcher-data" translate="no">
              Name
            </span>
          </div>
        </>
      );
    }
    render(
      <LanguageProvider>
        <KetcherHarness />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "zh" }));
    await waitFor(() => expect(screen.getByTestId("ketcher-label").textContent).toBe("清空画布"));
    // Even inside Ketcher, a marked value stays untouched.
    expect(screen.getByTestId("ketcher-data").textContent).toBe("Name");
  });
});

describe("translateKetcherPhrase", () => {
  it("translates only whole known phrases", () => {
    expect(translateKetcherPhrase("Clear Canvas", "zh-CN")).toBe("清空画布");
    expect(translateKetcherPhrase("Clear Canvas", "ja-JP")).toBe("キャンバスをクリア");
  });

  it("leaves English untouched", () => {
    expect(translateKetcherPhrase("Clear Canvas", "en-US")).toBe("Clear Canvas");
  });

  it("does not rewrite fragments inside a longer user string", () => {
    const note = "Name of the Type used for the Check on batch 2";
    expect(translateKetcherPhrase(note, "zh-CN")).toBe(note);
    expect(translateKetcherPhrase(note, "ja-JP")).toBe(note);
  });

  it("carries no LMD interface text at all", () => {
    // The table it replaced held 638 phrases, 608 of which were LMD's own words — a second,
    // string-matched translation of sentences the key catalogue already handled properly.
    for (const lmdPhrase of [
      "Molecule Library",
      "Search formulation names",
      "Descriptor calculation complete",
      "Loaded 3D Structure",
      "Excel/CSV file path"
    ]) {
      expect(translateKetcherPhrase(lmdPhrase, "zh-CN")).toBe(lmdPhrase);
    }
  });

  it("keeps the table small enough to be reviewable", () => {
    // Not a performance limit: a table nobody can read is a table nobody checks, and every entry
    // in it can silently rewrite text somewhere in the editor.
    expect(ketcherPhraseCount()).toBeLessThan(150);
    expect(ketcherPhraseCount()).toBeGreaterThan(50);
  });
});
