import { Empty } from "antd";

export default function EmptyState({ description = "暂无数据。" }: { description?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}
