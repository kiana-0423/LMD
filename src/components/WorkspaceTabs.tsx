import { Tabs } from "antd";
import { Children, type ReactNode } from "react";
import PagedContent from "./PagedContent";

/** Keep each task in the available workspace, preserving forms when switching tasks. */
export default function WorkspaceTabs({
  labels,
  children,
  unpagedKeys = []
}: {
  labels: ReactNode[];
  children: ReactNode;
  unpagedKeys?: string[];
}) {
  return (
    <Tabs
      className="workspace-tabs"
      items={Children.toArray(children).map((child, index) => ({
        key: String(index),
        label: labels[index],
        forceRender: true,
        children: unpagedKeys.includes(String(index)) ? (
          <div className="workspace-fixed-panel">{child}</div>
        ) : (
          <PagedContent>{child}</PagedContent>
        )
      }))}
    />
  );
}
