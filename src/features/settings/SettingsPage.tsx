import { Card, Form, Select, Typography } from "antd";
import PageHeader from "../../components/PageHeader";
import { SUPPORTED_LANGUAGES, useLanguage, type Language } from "../../i18n/LanguageContext";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="page-grid entry-page">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <Card title={t("settings.languageCard")}>
        <Form layout="vertical" style={{ maxWidth: 480 }}>
          <Form.Item label={t("settings.language")} extra={t("settings.languageHelp")}>
            <Select
              value={language}
              onChange={(value: Language) => setLanguage(value)}
              options={SUPPORTED_LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }))}
              aria-label={t("settings.language")}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">LMD · {language}</Typography.Text>
      </Card>
    </div>
  );
}
