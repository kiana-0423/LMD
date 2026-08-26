// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import KetcherTranslationBridge from "../features/molecule-sketcher/KetcherTranslationBridge";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

/**
 * Stands in for Ketcher's toolbar, which is rendered outside React by a third-party bundle.
 *
 * Every label here is a real Ketcher string, taken from `ketcher-react`'s own output. That matters:
 * the phrase table is now Ketcher-only, so a harness built from LMD's own words would pass or fail
 * for reasons that have nothing to do with what the bridge is for.
 */
function KetcherChromeHarness() {
  const { setLanguage, t } = useLanguage();
  const [showDynamicText, setShowDynamicText] = useState(false);
  const [dynamicTitle, setDynamicTitle] = useState("Zoom In");
  return (
    <div data-i18n-ketcher>
      <KetcherTranslationBridge />
      <h1>Clear Canvas</h1>
      <button type="button" onClick={() => setLanguage("zh-CN")}>
        Chinese
      </button>
      <button type="button" onClick={() => setLanguage("ja-JP")}>
        Japanese
      </button>
      <button type="button" onClick={() => setLanguage("en-US")}>
        English
      </button>
      <input data-testid="static-input" placeholder="Enter name" />
      {/* LMD's own text, translated by the key catalogue rather than by the bridge. */}
      <span>{t("menu.settings")}</span>
      {/* A stored value that happens to read like a label: it must survive untouched. */}
      <span translate="no">Name</span>
      <button type="button" onClick={() => setShowDynamicText(true)}>
        Add dynamic text
      </button>
      <button type="button" onClick={() => setDynamicTitle("Zoom Out")}>
        Change title
      </button>
      {showDynamicText && <span>Calculated Values</span>}
      <span data-testid="dynamic-title" title={dynamicTitle}>
        tool
      </span>
      <section>
        <span>Periodic Table</span>
        <span translate="no">ZDDP-Chain-Ester-01</span>
      </section>
      <p data-testid="after-skipped-subtree">Clear Canvas</p>
    </div>
  );
}

describe("KetcherTranslationBridge", () => {
  beforeEach(() => window.localStorage.clear());

  it("translates Ketcher's own text and attributes in every language", async () => {
    render(
      <LanguageProvider>
        <KetcherChromeHarness />
      </LanguageProvider>
    );
    expect(screen.getByRole("heading", { name: "Clear Canvas" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chinese" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "清空画布" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("输入名称");
    expect(screen.getByText("设置")).toBeTruthy();
    // Marked as data, so it keeps its stored form even though "Name" is in the table.
    expect(screen.getByText("Name")).toBeTruthy();

    // Ketcher rebuilds its own DOM constantly; anything it adds afterwards must be translated too.
    fireEvent.click(screen.getByRole("button", { name: "Add dynamic text" }));
    await waitFor(() => expect(screen.getByText("计算值")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Change title" }));
    await waitFor(() => expect(screen.getByTestId("dynamic-title").getAttribute("title")).toBe("缩小"));

    fireEvent.click(screen.getByRole("button", { name: "Japanese" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "キャンバスをクリア" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("名前を入力");
    expect(screen.getByText("設定")).toBeTruthy();
    expect(screen.getByText("計算値")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Clear Canvas" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("Enter name");
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Calculated Values")).toBeTruthy();
  });

  it("keeps translating after a skipped element that is the last child of its parent", async () => {
    render(
      <LanguageProvider>
        <KetcherChromeHarness />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Chinese" }));
    await waitFor(() => expect(screen.getByTestId("after-skipped-subtree").textContent).toBe("清空画布"));
    expect(screen.getByText("ZDDP-Chain-Ester-01")).toBeTruthy();
    expect(screen.getByText("元素周期表")).toBeTruthy();
  });
});
