import { invokeCommand } from "../tauri";

type Envelope<T> = { data?: T } & Partial<T>;

function unwrap<T>(value: Envelope<T>): T {
  return (value?.data ?? value) as T;
}

export async function listPerformanceMetrics() {
  const value = await invokeCommand<
    Envelope<{ metrics: { column: string; labelCode?: string; label: string; unit: string }[] }>
  >("list_performance_metrics", {});
  return unwrap(value).metrics;
}

