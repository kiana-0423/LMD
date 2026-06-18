import { Card, Skeleton } from "antd";

export default function LoadingBlock() {
  return (
    <Card>
      <Skeleton active paragraph={{ rows: 4 }} />
    </Card>
  );
}
