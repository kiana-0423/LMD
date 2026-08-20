// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "../components/EmptyState";
import LoadingBlock from "../components/LoadingBlock";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

describe("shared components", () => {
  it("renders EmptyState with a custom description", () => {
    render(<EmptyState description="No results" />);
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("renders LoadingBlock skeleton content", () => {
    const { container } = render(<LoadingBlock />);
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("renders StatCard title and value", () => {
    render(<StatCard title="Molecules" value={12} />);
    expect(screen.getByText("Molecules")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("renders PageHeader description and extra actions", () => {
    render(<PageHeader title="Page Title" description="Page description" extra={<button type="button">Action</button>} />);
    expect(screen.getByRole("heading", { name: "Page Title" })).toBeTruthy();
    expect(screen.getByText("Page description")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Action" })).toBeTruthy();
  });
});
