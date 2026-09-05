import { Skeleton } from "antd";
import { Suspense, lazy } from "react";
import type { CSSProperties } from "react";
import type { LmdChartOption } from "./EChartCanvas";

/**
 * The chart, loaded when a chart is actually drawn.
 *
 * Even trimmed to the series LMD uses, ECharts is the largest single dependency on the analysis
 * route — about 190 kB gzipped, against 100 kB for everything else the page needs. Opening the page
 * to read the metric list, or to find that a workspace has too few measurements to plot, does not
 * need any of it.
 *
 * The `import()` is a code split, not a network request: the chunk lives in the application's own
 * bundle and is read from disk.
 */
const EChartCanvas = lazy(() => import("./EChartCanvas"));

export type { LmdChartOption };

export default function EChart({
  option,
  height = 340,
  ariaLabel
}: {
  option: LmdChartOption;
  height?: CSSProperties["height"];
  ariaLabel?: string;
}) {
  return (
    <Suspense fallback={<Skeleton.Node active style={{ width: "100%", height }} />}>
      <EChartCanvas option={option} height={height} ariaLabel={ariaLabel} />
    </Suspense>
  );
}
