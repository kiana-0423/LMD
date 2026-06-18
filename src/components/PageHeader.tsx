import { Typography } from "antd";
import type React from "react";

export default function PageHeader({
  title,
  description,
  extra
}: {
  title: string;
  description?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        {description && <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>}
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </div>
  );
}
