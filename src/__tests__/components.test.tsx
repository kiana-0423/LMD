// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "../components/EmptyState";
import LoadingBlock from "../components/LoadingBlock";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

describe("shared components", () => {
  it("renders EmptyState with a custom description", () => {
    render(<EmptyState description="没有结果" />);
    expect(screen.getByText("没有结果")).toBeTruthy();
  });

  it("renders LoadingBlock skeleton content", () => {
    const { container } = render(<LoadingBlock />);
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("renders StatCard title and value", () => {
    render(<StatCard title="分子" value={12} />);
    expect(screen.getByText("分子")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("renders PageHeader description and extra actions", () => {
    render(<PageHeader title="页面标题" description="页面描述" extra={<button type="button">操作</button>} />);
    expect(screen.getByRole("heading", { name: "页面标题" })).toBeTruthy();
    expect(screen.getByText("页面描述")).toBeTruthy();
    expect(screen.getByRole("button", { name: "操作" })).toBeTruthy();
  });
});
