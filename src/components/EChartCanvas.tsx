import { BarChart, ScatterChart, LineChart, BoxplotChart } from "echarts/charts";
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  TransformComponent
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { BarSeriesOption, BoxplotSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  LegendComponentOption,
  TitleComponentOption,
  TooltipComponentOption
} from "echarts/components";
import type { ComposeOption, ECharts } from "echarts/core";
import { useEffect, useRef } from "react";

/**
 * ECharts, with only the parts LMD draws.
 *
 * The full `echarts` package registers every chart type it has — maps, treemaps, graphs, gauges,
 * the SVG renderer, geographic coordinate systems — and none of them can be tree-shaken, because
 * importing the package is what registers them. LMD draws bars, scatter plots, one line and one
 * box plot, on a Cartesian grid, in canvas. Registering exactly that is the difference between a
 * megabyte of charting library and about a fifth of it.
 *
 * Adding a chart type to a page means adding its import here; a series ECharts has not been given
 * fails loudly at render rather than silently drawing nothing, so the omission is visible.
 */
echarts.use([
  BarChart,
  ScatterChart,
  LineChart,
  BoxplotChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  MarkLineComponent,
  DatasetComponent,
  TransformComponent,
  CanvasRenderer
]);

/** The option shape, narrowed to the series and components registered above. */
export type LmdChartOption = ComposeOption<
  | BarSeriesOption
  | ScatterSeriesOption
  | LineSeriesOption
  | BoxplotSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | TitleComponentOption
  | LegendComponentOption
>;

export default function EChart({
  option,
  height = 340,
  ariaLabel
}: {
  option: LmdChartOption;
  height?: number;
  ariaLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts>();

  useEffect(() => {
    if (!container.current) return;
    chart.current = echarts.init(container.current);
    const resize = () => chart.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.current?.dispose();
      chart.current = undefined;
    };
  }, []);

  useEffect(() => {
    // `notMerge` keeps a shrinking series from leaving stale points behind.
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={container} style={{ width: "100%", height }} role="img" aria-label={ariaLabel} />;
}
