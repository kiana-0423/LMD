// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

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
    expect(screen.getByText("設定")).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem("lmd.language.v2")).toBe("ja-JP"));
    expect(document.documentElement.lang).toBe("ja-JP");
  });

  it("restores a saved language", () => {
    window.localStorage.setItem("lmd.language.v2", "zh-CN");
    render(<LanguageProvider><LanguageHarness /></LanguageProvider>);
    expect(screen.getByText("zh-CN")).toBeTruthy();
    expect(screen.getByText("设置")).toBeTruthy();
  });
});
