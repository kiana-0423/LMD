// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import DocumentTranslationBridge from "../i18n/DocumentTranslationBridge";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

function TranslationHarness() {
  const { setLanguage, t } = useLanguage();
  const [showDynamicText, setShowDynamicText] = useState(false);
  const [dynamicPlaceholder, setDynamicPlaceholder] = useState("Search formulation names");
  return (
    <>
      <DocumentTranslationBridge />
      <h1>Molecule Library</h1>
      <button type="button" onClick={() => setLanguage("zh-CN")}>
        Chinese
      </button>
      <button type="button" onClick={() => setLanguage("ja-JP")}>
        Japanese
      </button>
      <button type="button" onClick={() => setLanguage("en-US")}>
        English
      </button>
      <input data-testid="static-input" placeholder="Search formulation names" />
      <span>{t("menu.settings")}</span>
      <span>Loaded 3D Structure</span>
      <span>SMILES is required for a new molecule. Enter SMILES first.</span>
      <button type="button" onClick={() => setShowDynamicText(true)}>
        Add dynamic text
      </button>
      <button type="button" onClick={() => setDynamicPlaceholder("Excel/CSV file path")}>
        Change placeholder
      </button>
      {showDynamicText && <span>Descriptor calculation complete</span>}
      <input data-testid="dynamic-input" placeholder={dynamicPlaceholder} />
    </>
  );
}

describe("DocumentTranslationBridge", () => {
  beforeEach(() => window.localStorage.clear());

  it("updates business text, attributes, and context text for every language", async () => {
    render(
      <LanguageProvider>
        <TranslationHarness />
      </LanguageProvider>
    );
    expect(screen.getByRole("heading", { name: "Molecule Library" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chinese" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "分子库" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("搜索配方名称");
    expect(screen.getByText("设置")).toBeTruthy();
    expect(screen.getByText("已加载的 3D 结构")).toBeTruthy();
    expect(screen.getByText("新分子必须提供 SMILES。请先输入 SMILES。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add dynamic text" }));
    await waitFor(() => expect(screen.getByText("描述符计算完成")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Change placeholder" }));
    await waitFor(() =>
      expect(screen.getByTestId("dynamic-input").getAttribute("placeholder")).toBe("Excel/CSV 文件路径")
    );

    fireEvent.click(screen.getByRole("button", { name: "Japanese" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "分子ライブラリ" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("配合名を検索");
    expect(screen.getByText("設定")).toBeTruthy();
    expect(screen.getByText("読み込み済み 3D 構造")).toBeTruthy();
    expect(screen.getByText("新規分子には SMILES が必要です。先に SMILES を入力してください。")).toBeTruthy();
    expect(screen.getByText("記述子の計算が完了しました")).toBeTruthy();
    expect(screen.getByTestId("dynamic-input").getAttribute("placeholder")).toBe("Excel/CSV ファイルパス");

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Molecule Library" })).toBeTruthy());
    expect(screen.getByTestId("static-input").getAttribute("placeholder")).toBe("Search formulation names");
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Loaded 3D Structure")).toBeTruthy();
    expect(screen.getByText("Descriptor calculation complete")).toBeTruthy();
    expect(screen.getByTestId("dynamic-input").getAttribute("placeholder")).toBe("Excel/CSV file path");
  });
});
