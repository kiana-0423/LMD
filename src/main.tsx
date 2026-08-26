import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import type { Locale } from "antd/es/locale";
import enUS from "antd/locale/en_US";
import "./lib/browserShims";
import App from "./App";
import "antd/dist/reset.css";
import "./styles/global.css";
import { LanguageProvider, useLanguage, type Language } from "./i18n/LanguageContext";

/**
 * Ant Design's own locale files, loaded the same way LMD's are.
 *
 * English is bundled because it is the default and the fallback; the other two are read from the
 * application's bundle when they are first selected. All three are local files — this is a code
 * split, not a network request, and the application stays entirely offline.
 */
const ANTD_LOADERS: Record<Exclude<Language, "en-US">, () => Promise<{ default: Locale }>> = {
  "zh-CN": () => import("antd/locale/zh_CN"),
  "ja-JP": () => import("antd/locale/ja_JP")
};

// This bootstrap-only component selects the Ant Design locale before rendering the app.
// eslint-disable-next-line react-refresh/only-export-components
function LocalizedApp() {
  const { language } = useLanguage();
  const [antdLocale, setAntdLocale] = useState<Locale>(enUS);

  useEffect(() => {
    if (language === "en-US") {
      setAntdLocale(enUS);
      return;
    }
    let cancelled = false;
    ANTD_LOADERS[language]()
      .then((module) => {
        if (!cancelled) setAntdLocale(module.default);
      })
      .catch(() => {
        // Ant Design's own words — "No data", a date picker's month names — staying in English is
        // a cosmetic loss. Leaving the application without a locale object at all is not: it
        // throws inside every component that reads one.
        if (!cancelled) setAntdLocale(enUS);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: "#0f766e",
          borderRadius: 6,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        },
        components: {
          Layout: { siderBg: "#132238", headerBg: "#ffffff", bodyBg: "#eef3f7" }
        }
      }}
    >
      <App />
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <LocalizedApp />
    </LanguageProvider>
  </React.StrictMode>
);
