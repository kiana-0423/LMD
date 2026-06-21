import { Card, Statistic } from "antd";
import styles from "./StatCard.module.css";

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
    <Card className={styles.statCard}>
      <Statistic title={title} value={value} suffix={suffix} />
    </Card>
  );
}
