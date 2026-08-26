// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

/**
 * English is bundled; Chinese and Japanese arrive as their own chunks, so a switch resolves on a
 * later tick. `findByText` is what makes that visible in a test rather than a race.
 */

function LanguageHarness() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <span>{language}</span>
      <span>{t("menu.settings")}</span>
      <button type="button" onClick={() => setLanguage("ja-JP")}>Japanese</button>
    </div>
  );
}

describe("LanguageProvider", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to English", () => {
    render(<LanguageProvider><LanguageHarness /></LanguageProvider>);
    expect(screen.getByText("en-US")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("switches language and persists the preference", async () => {
    render(<LanguageProvider><LanguageHarness /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Japanese" }));
    expect(screen.getByText("ja-JP")).toBeTruthy();
    // The label follows once the locale chunk has been read from the bundle.
    expect(await screen.findByText("設定")).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem("lmd.language.v2")).toBe("ja-JP"));
    expect(document.documentElement.lang).toBe("ja-JP");
  });

  it("restores a saved language", async () => {
    window.localStorage.setItem("lmd.language.v2", "zh-CN");
    render(<LanguageProvider><LanguageHarness /></LanguageProvider>);
    expect(screen.getByText("zh-CN")).toBeTruthy();
    expect(await screen.findByText("设置")).toBeTruthy();
  });

  it("never leaves a label empty while a locale chunk is still arriving", async () => {
    // The moment between the click and the chunk resolving is the one that has to be right. A user
    // can act on an interface that is briefly in the wrong language; they cannot act on an empty
    // one, and a provider that swapped `language` before the words arrived would produce exactly
    // that.
    const { container } = render(<LanguageProvider><LanguageHarness /></LanguageProvider>);
    const label = () => container.querySelectorAll("span")[1]?.textContent ?? "";

    expect(label()).toBe("Settings");
    fireEvent.click(screen.getByRole("button", { name: "Japanese" }));
    expect(label(), "the label must never be empty mid-switch").not.toBe("");

    await waitFor(() => expect(label()).toBe("設定"));
  });
});
