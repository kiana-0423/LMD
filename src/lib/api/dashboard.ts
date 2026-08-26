import type { DashboardSummary } from "../../types";
import { invokeCommand } from "../tauri";

export async function getDashboardSummary() {
  return invokeCommand<DashboardSummary>("get_dashboard_summary", {});
}
