// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { messagesForLanguage } from "../i18n/catalogues";
import type { ModelMetrics } from "../lib/api";
const mock = vi.hoisted(() => ({ charts: vi.fn() }));
vi.mock("../components/EChartCanvas", () => ({
  default: (props: unknown) => {
    mock.charts(props);
    return <div data-testid="evaluation-chart" />;
  }
}));
import ModelEvaluation from "../features/data-mining/ModelEvaluation";

const en = messagesForLanguage("en-US");
const fixture: ModelMetrics = {
  validation: { r2: -0.25, mae: 0.5, rmse: 0.5, sample_count: 2 },
  diagnostics: {
    version: 1,
    cohort: "validation",
    sample_count: 2,
    points_sampled: false,
    residual_mean: 0,
    points: [
      { id: "a", label: "A", actual: 1, predicted: 1.5, residual: 0.5 },
      { id: "b", label: "B", actual: 2, predicted: 1.5, residual: -0.5 }
    ],
    residual_histogram: [
      { start: -0.5, end: 0, count: 1 },
      { start: 0, end: 0.5, count: 1 }
    ],
    provenance: { synthetic_count: 0, total_count: 8, unmarked_count: 8, batch_ids: [] }
  }
};
const chart = () => mock.charts.mock.calls[mock.charts.mock.calls.length - 1]![0].option;
const metricValues = () =>
  Array.from(document.querySelectorAll(".ant-statistic-content-value"), (node) => node.textContent);
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it("shows negative R² and plots saved predictions with equal target and prediction ranges", async () => {
  renderWithLanguage(<ModelEvaluation metrics={fixture} unit="mm" />);
  expect(metricValues()).toContain("-0.2500");
  expect(screen.getByText(en["model.heldOut"])).toBeTruthy();
  await screen.findByTestId("evaluation-chart");
  expect(chart().series[0].data.map((point: { value: number[] }) => point.value)).toEqual([
    [1, 1.5],
    [2, 1.5]
  ]);
  expect(chart().xAxis.min).toBe(chart().yAxis.min);
  expect(chart().xAxis.max).toBe(chart().yAxis.max);
  expect(chart().xAxis.name).toBe("Target value (mm)");
  expect(chart().series[1].data[0][0]).toBe(chart().series[1].data[0][1]);
  fireEvent.click(screen.getByRole("radio", { name: en["model.evaluationResiduals"] }));
  expect(chart().series[0].data.map((point: { value: number[] }) => point.value)).toEqual([
    [1.5, 0.5],
    [1.5, -0.5]
  ]);
  expect(chart().series[0].markLine.data).toEqual([{ yAxis: 0 }]);
  fireEvent.click(screen.getByRole("radio", { name: en["model.evaluationHistogram"] }));
  expect(chart().series[0].type).toBe("bar");
  expect(chart().series[0].data).toEqual([1, 1]);
});

it("labels generated data and sampled points while using the complete histogram", async () => {
  renderWithLanguage(
    <ModelEvaluation
      metrics={{
        ...fixture,
        diagnostics: {
          ...fixture.diagnostics!,
          sample_count: 1500,
          points_sampled: true,
          residual_histogram: [
            { start: -1, end: 0, count: 700 },
            { start: 0, end: 1, count: 800 }
          ],
          provenance: { synthetic_count: 4, total_count: 8, unmarked_count: 4, batch_ids: ["demo"] }
        }
      }}
    />,
    "zh-CN"
  );
  expect(await screen.findByText(/4\/8 条为生成数据/)).toBeTruthy();
  expect(screen.getByText(/2\/1500 条/)).toBeTruthy();
  await screen.findByTestId("evaluation-chart");
  fireEvent.click(screen.getByRole("radio", { name: "误差分布" }));
  expect(chart().series[0].data).toEqual([700, 800]);
});

it("keeps zero errors and identifies training-only results", () => {
  renderWithLanguage(
    <ModelEvaluation
      metrics={{
        training_only: { r2: 1, mae: 0, rmse: 0 },
        diagnostics: { ...fixture.diagnostics!, cohort: "training_only" }
      }}
    />
  );
  expect(metricValues().filter((value) => value === "0.00000")).toHaveLength(2);
  expect(screen.getByText(en["model.inSample"])).toBeTruthy();
  expect(screen.getByText(en["model.evaluationInSampleHelp"])).toBeTruthy();
});

it("retains legacy scores without inventing plots", () => {
  renderWithLanguage(<ModelEvaluation metrics={{ validation: fixture.validation }} />);
  expect(metricValues()).toContain("-0.2500");
  expect(screen.getByText(en["model.evaluationMissing"])).toBeTruthy();
  expect(screen.queryByTestId("evaluation-chart")).toBeNull();
});
