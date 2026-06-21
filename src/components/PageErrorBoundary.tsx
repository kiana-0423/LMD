import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card, Typography } from "antd";

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
      return (
        <Card className="error-panel">
          <Typography.Title level={4}>页面加载失败</Typography.Title>
          <Typography.Paragraph>{this.state.errorText}</Typography.Paragraph>
        </Card>
      );
    }
    return this.props.children;
  }
}
