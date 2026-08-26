import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card, Typography } from "antd";
import { useLanguage } from "../i18n/LanguageContext";
import { describeBackendError } from "../lib/backendErrors";

// The boundary itself has to be a class — only a class component can catch a render error — so its
// message lives in this function component, which can use the translation hook. The class carries
// the error unchanged and the translation happens here, at the moment of rendering, so a message
// that arrived with a code is read in the user's language rather than as a bracketed identifier.
// eslint-disable-next-line react-refresh/only-export-components
function ErrorPanel({ errorText }: { errorText: string }) {
  const { t } = useLanguage();
  const { summary, detail } = describeBackendError(errorText, t);
  return (
    <Card className="error-panel">
      <Typography.Title level={4}>{t("ui.pageFailedToLoad")}</Typography.Title>
      <Typography.Paragraph>{summary}</Typography.Paragraph>
      {detail ? (
        <Typography.Paragraph type="secondary">
          <span translate="no">{detail}</span>
        </Typography.Paragraph>
      ) : null}
    </Card>
  );
}

export default class PageErrorBoundary extends Component<{ children: ReactNode }, { errorText: string }> {
  state = { errorText: "" };

  static getDerivedStateFromError(error: unknown) {
    return { errorText: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.errorText) {
      return <ErrorPanel errorText={this.state.errorText} />;
    }
    return this.props.children;
  }
}
