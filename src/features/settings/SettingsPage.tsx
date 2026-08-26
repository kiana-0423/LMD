import { Card, Form, Select, Space, Typography } from "antd";
import PageHeader from "../../components/PageHeader";
import { APP_NAME } from "../../lib/constants";
import { SUPPORTED_LANGUAGES, useLanguage, type Language } from "../../i18n/LanguageContext";
import WorkspaceCard from "./WorkspaceCard";
import DiagnosticsCard from "./DiagnosticsCard";

export default function SettingsPage() {
  const { language, setLanguage, t, loading, loadError } = useLanguage();

  return (
    <div className="page-grid entry-page">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title={t("settings.languageCard")}>
          <Form layout="vertical" style={{ maxWidth: 480 }}>
            <Form.Item
              label={t("settings.language")}
              extra={loadError ? t("language.loadFailed") : t("settings.languageHelp")}
              validateStatus={loadError ? "warning" : undefined}
            >
              <Select
                value={language}
                loading={loading}
                onChange={(value: Language) => setLanguage(value)}
                options={SUPPORTED_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }))}
                aria-label={t("settings.language")}
              />
            </Form.Item>
          </Form>
          {/* i18n-exempt: the application name and the language tag are both identifiers. */}
          <Typography.Text type="secondary">{`${APP_NAME} · ${language}`}</Typography.Text>
        </Card>

        <WorkspaceCard />
        <DiagnosticsCard />
      </Space>
    </div>
  );
}
