import { Card, Statistic } from "antd";

export default function StatCard({
  title,
  value,
  suffix
}: {
  title: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <Card className="stat-card">
      <Statistic title={title} value={value} suffix={suffix} />
    </Card>
  );
}
