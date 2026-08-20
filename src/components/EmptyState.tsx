import { Empty } from "antd";

export default function EmptyState({ description = "No data available." }: { description?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}
