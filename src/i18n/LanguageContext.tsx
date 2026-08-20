import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US", "ja-JP"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "lmd.language.v2";

const messages = {
  "zh-CN": {
    "app.subtitle": "本地润滑材料数据库与智能设计 MVP",
    "app.nameChinese": "LMD",
    "menu.dashboardGroup": "仪表盘",
    "menu.dashboard": "仪表盘",
    "menu.database": "数据库",
    "menu.molecules": "分子库",
    "menu.descriptors": "描述符中心",
    "menu.baseAdditive": "基础油/添加剂库",
    "menu.formulations": "配方库",
    "menu.experiments": "实验与性能",
    "menu.input": "录入",
    "menu.moleculeEntry": "分子录入",
    "menu.moleculeSketcher": "分子绘画",
    "menu.formulationEntry": "配方录入",
    "menu.dataMining": "数据挖掘",
    "menu.moleculePerformance": "分子性能预测",
    "menu.formulationPrediction": "配方预测",
    "menu.moleculeDesign": "分子设计",
    "menu.system": "系统",
    "menu.importExport": "导入/导出",
    "menu.settings": "设置",
    "status.workspace": "工作区",
    "status.sqliteReady": "SQLite 就绪",
    "status.sqliteUnavailable": "SQLite 未就绪",
    "status.sidecarReal": "Python Sidecar 真实模式",
    "status.sidecarMock": "Python Sidecar 模拟模式",
    "status.sidecarUnavailable": "Python Sidecar 不可用",
    "status.sidecarChecking": "Python Sidecar 检查中",
    "settings.title": "设置",
    "settings.description": "管理应用的显示与偏好设置。",
    "settings.languageCard": "语言与地区",
    "settings.language": "界面语言",
    "settings.languageHelp": "更改会立即生效，并在下次启动时保留。",
    "language.zh-CN": "简体中文",
    "language.en-US": "English",
    "language.ja-JP": "日本語"
  },
  "en-US": {
    "app.subtitle": "Local Lubricant Materials Database & Intelligent Design MVP",
    "app.nameChinese": "LMD",
    "menu.dashboardGroup": "Dashboard",
    "menu.dashboard": "Dashboard",
    "menu.database": "Database",
    "menu.molecules": "Molecule Library",
    "menu.descriptors": "Descriptor Center",
    "menu.baseAdditive": "Base Oils / Additives",
    "menu.formulations": "Formulation Library",
    "menu.experiments": "Experiments & Performance",
    "menu.input": "Data Entry",
    "menu.moleculeEntry": "Molecule Entry",
    "menu.moleculeSketcher": "Molecule Sketcher",
    "menu.formulationEntry": "Formulation Entry",
    "menu.dataMining": "Data Mining",
    "menu.moleculePerformance": "Molecule Performance",
    "menu.formulationPrediction": "Formulation Prediction",
    "menu.moleculeDesign": "Molecule Design",
    "menu.system": "System",
    "menu.importExport": "Import / Export",
    "menu.settings": "Settings",
    "status.workspace": "Workspace",
    "status.sqliteReady": "SQLite Ready",
    "status.sqliteUnavailable": "SQLite Not Ready",
    "status.sidecarReal": "Python Sidecar: Live",
    "status.sidecarMock": "Python Sidecar: Mock",
    "status.sidecarUnavailable": "Python Sidecar Unavailable",
    "status.sidecarChecking": "Checking Python Sidecar",
    "settings.title": "Settings",
    "settings.description": "Manage display and application preferences.",
    "settings.languageCard": "Language & Region",
    "settings.language": "Interface language",
    "settings.languageHelp": "Changes apply immediately and are kept for the next launch.",
    "language.zh-CN": "简体中文",
    "language.en-US": "English",
    "language.ja-JP": "日本語"
  },
  "ja-JP": {
    "app.subtitle": "ローカル潤滑材料データベース＆インテリジェント設計 MVP",
    "app.nameChinese": "LMD",
    "menu.dashboardGroup": "ダッシュボード",
    "menu.dashboard": "ダッシュボード",
    "menu.database": "データベース",
    "menu.molecules": "分子ライブラリ",
    "menu.descriptors": "記述子センター",
    "menu.baseAdditive": "基油・添加剤ライブラリ",
    "menu.formulations": "配合ライブラリ",
    "menu.experiments": "実験・性能",
    "menu.input": "データ入力",
    "menu.moleculeEntry": "分子入力",
    "menu.moleculeSketcher": "分子描画",
    "menu.formulationEntry": "配合入力",
    "menu.dataMining": "データマイニング",
    "menu.moleculePerformance": "分子性能予測",
    "menu.formulationPrediction": "配合予測",
    "menu.moleculeDesign": "分子設計",
    "menu.system": "システム",
    "menu.importExport": "インポート・エクスポート",
    "menu.settings": "設定",
    "status.workspace": "ワークスペース",
    "status.sqliteReady": "SQLite 準備完了",
    "status.sqliteUnavailable": "SQLite 未準備",
    "status.sidecarReal": "Python Sidecar：実行モード",
    "status.sidecarMock": "Python Sidecar：モックモード",
    "status.sidecarUnavailable": "Python Sidecar 利用不可",
    "status.sidecarChecking": "Python Sidecar 確認中",
    "settings.title": "設定",
    "settings.description": "表示とアプリケーションの設定を管理します。",
    "settings.languageCard": "言語と地域",
    "settings.language": "表示言語",
    "settings.languageHelp": "変更はすぐに反映され、次回起動時にも保持されます。",
    "language.zh-CN": "简体中文",
    "language.en-US": "English",
    "language.ja-JP": "日本語"
  }
} as const;

export type MessageKey = keyof (typeof messages)["zh-CN"];

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  if (typeof window === "undefined") return "en-US";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(saved as Language) ? (saved as Language) : "en-US";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t: (key) => messages[language][key] }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// The provider and its hook intentionally share one context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
