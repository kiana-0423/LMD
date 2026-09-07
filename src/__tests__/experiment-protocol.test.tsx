// @vitest-environment jsdom
import { Form } from "antd";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ExperimentFields from "../features/experiments/ExperimentFields";
import { experimentPayload, TEST_TYPES } from "../lib/experimentProtocol";
import { renderWithLanguage } from "./renderWithLanguage";

afterEach(cleanup);

it("offers the new test taxonomy without obsolete standalone methods", () => {
  expect(TEST_TYPES.map((item) => item.value)).toEqual(["UMT", "four-ball", "TE77", "PDSC", "TGA", "kinematic-viscosity", "corrosion", "other"]);
});

it("switches UMT modes and replaces stroke/frequency with radius/rpm", async () => {
  renderWithLanguage(<Form initialValues={{ testType: "UMT", testParameters: { mode: "reciprocating" } }}><ExperimentFields /></Form>);
  expect(await screen.findByLabelText("Stroke")).toBeTruthy();
  expect(screen.getByLabelText("Frequency")).toBeTruthy();
  expect(screen.queryByLabelText("Track radius")).toBeNull();
  fireEvent.mouseDown(screen.getByLabelText("Test mode"));
  fireEvent.click(await screen.findByTitle("Ball-on-disk Test"));
  expect(await screen.findByLabelText("Track radius")).toBeTruthy();
  expect(screen.getByLabelText("Rotational speed")).toBeTruthy();
  expect(screen.queryByLabelText("Stroke")).toBeNull();
});

it("provides reciprocating parameters for TE77 and isolates TGA results", async () => {
  const rendered = renderWithLanguage(<Form initialValues={{ testType: "TE77" }}><ExperimentFields /></Form>);
  expect(await screen.findByLabelText("Stroke")).toBeTruthy();
  expect(screen.getByLabelText("Frequency")).toBeTruthy();
  rendered.unmount();
  renderWithLanguage(<Form initialValues={{ testType: "TGA" }}><ExperimentFields /></Form>);
  fireEvent.click(screen.getByRole("tab", { name: "Performance results" }));
  expect(await screen.findByLabelText("Initial thermal decomposition temperature")).toBeTruthy();
  expect(screen.queryByLabelText("Average Friction Coefficient")).toBeNull();
});

it("maps kinematic viscosity to the selected 40/100 C measurement only", async () => {
  renderWithLanguage(<Form initialValues={{ testType: "kinematic-viscosity", temperatureValue: 40 }}><ExperimentFields /></Form>);
  expect(await screen.findByLabelText("Kinematic viscosity at 40 °C")).toBeTruthy();
  fireEvent.mouseDown(screen.getByLabelText("Temperature"));
  fireEvent.click(await screen.findByTitle("100 °C"));
  expect(await screen.findByLabelText("Kinematic viscosity at 100 °C")).toBeTruthy();
  expect(screen.queryByLabelText("Kinematic viscosity at 40 °C")).toBeNull();
});

it("clears hidden values and never sends client-authored mean provenance", () => {
  const result = experimentPayload({ testType: "TGA", initialDecompositionTemperatureValue: 300, averageFrictionCoefficient: 0.1, loadValue: 50,
    testParameters: { mode: "ball-on-disk", radiusMm: 5, speedRpm: 100, humidityPercent: 0, environmentProvenance: { humidityPercent: { source: "mean" } } } });
  expect(result.averageFrictionCoefficient).toBeNull();
  expect(result.loadValue).toBeNull();
  expect(result.initialDecompositionTemperatureValue).toBe(300);
  expect(result.testParameters?.radiusMm).toBeNull();
  expect(result.testParameters?.humidityPercent).toBe(0);
  expect(result.testParameters?.environmentProvenance).toBeUndefined();
});
