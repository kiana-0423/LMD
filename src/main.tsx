import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import jaJP from "antd/locale/ja_JP";
import "./lib/browserShims";
import App from "./App";
import "antd/dist/reset.css";
import "./styles/global.css";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import DocumentTranslationBridge from "./i18n/DocumentTranslationBridge";

const antdLocales = { "zh-CN": zhCN, "en-US": enUS, "ja-JP": jaJP } as const;

// This bootstrap-only component selects the Ant Design locale before rendering the app.
// eslint-disable-next-line react-refresh/only-export-components
function LocalizedApp() {
  const { language } = useLanguage();

  return (
    <ConfigProvider
      locale={antdLocales[language]}
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
      <DocumentTranslationBridge />
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
