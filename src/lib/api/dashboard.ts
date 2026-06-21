import type { DashboardSummary } from "../../types";
import { mockGetDashboardSummary } from "../api.mock";
import { invokeOrMock } from "../tauri";

export async function getDashboardSummary() {
  return invokeOrMock<DashboardSummary>("get_dashboard_summary", {}, mockGetDashboardSummary);
}
