// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageContext";

/**
 * A blank form must not save numbers nobody entered.
 *
 * Every value these forms used to pre-fill was a scientific claim: 99 wt% of base oil, 1 wt% of
 * additive, "stirring", "SRV", three repetitions, Group III. None had been measured, none were
 * distinguishable afterwards from a value the operator had typed, and all of them fed the model
 * training and the analysis charts.
 */

const createFormulation = vi.fn();
const saveExperimentWithPerformance = vi.fn();

vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  return createApiMock({
    createFormulation: (...args: unknown[]) => createFormulation(...args),
    saveExperimentWithPerformance: (...args: unknown[]) => saveExperimentWithPerformance(...args),
    searchBaseOils: () => Promise.resolve([{ id: "bo-1", label: "PAO 6", detail: "PAO" }]),
    searchAdditives: () => Promise.resolve([{ id: "ad-1", label: "ZDDP", detail: "antiwear" }]),
    searchFormulations: () => Promise.resolve([{ id: "f-1", label: "PAO 6 + ZDDP", detail: "" }])
  });
});

afterEach(() => {
  cleanup();
  createFormulation.mockReset();
  saveExperimentWithPerformance.mockReset();
  document.body.innerHTML = "";
});

async function renderPage(path: string) {
  const module = await import(path);
  const Page = module.default as () => JSX.Element;
  render(
    <LanguageProvider>
      <Page />
    </LanguageProvider>
  );
}

describe("formulation entry", () => {
  it("pre-fills units but never a concentration or a preparation method", async () => {
    await renderPage("../features/formulation-entry/FormulationEntryPage");
    await screen.findByLabelText("Formulation Name");

    const ratio = screen.getByLabelText("Base-oil Ratio") as HTMLInputElement;
    expect(ratio.value, "a base-oil ratio must not be filled in for the user").toBe("");

    const additiveRatio = screen.getByLabelText("Ratio") as HTMLInputElement;
    expect(additiveRatio.value, "an additive ratio must not be filled in either").toBe("");

    // The unit *is* pre-selected, and that is fine: it is a label on a number the user is about
    // to type, and it is visible in the field beside it.
    expect(screen.getAllByTitle("wt%").length).toBeGreaterThan(0);
  });

  it("refuses to submit without the values a blend cannot be described without", async () => {
    await renderPage("../features/formulation-entry/FormulationEntryPage");
    await screen.findByLabelText("Formulation Name");

    fireEvent.click(screen.getByRole("button", { name: "Save Formulation" }));

    // Nothing reaches the backend, because there is nothing real to send.
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(createFormulation).not.toHaveBeenCalled();
  });

  it("refuses a concentration of zero, as the backend does", async () => {
    await renderPage("../features/formulation-entry/FormulationEntryPage");
    await screen.findByLabelText("Formulation Name");

    fireEvent.change(screen.getByLabelText("Formulation Name"), { target: { value: "Trial 1" } });
    fireEvent.change(screen.getByLabelText("Base-oil Ratio"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Formulation" }));

    await waitFor(() =>
      expect(screen.getByText("Enter the concentration that was actually used.")).toBeTruthy()
    );
    expect(createFormulation).not.toHaveBeenCalled();
  });
});

describe("experiment entry", () => {
  it("assumes no test type and no repeat count", async () => {
    await renderPage("../features/experiments/ExperimentPerformancePage");
    await screen.findByLabelText("Test Type");

    // "SRV" used to be selected before anyone looked at the field.
    expect(screen.getByLabelText("Test Type").getAttribute("value") ?? "").toBe("");
    expect((screen.getByLabelText("Repeat Count") as HTMLInputElement).value).toBe("");
  });

  it("will not save until the method that was used has been chosen", async () => {
    await renderPage("../features/experiments/ExperimentPerformancePage");
    await screen.findByLabelText("Test Type");

    fireEvent.click(screen.getByRole("button", { name: "Save Experiment and Performance" }));

    await waitFor(() =>
      expect(screen.getByText("Select the test method that was used.")).toBeTruthy()
    );
    expect(saveExperimentWithPerformance).not.toHaveBeenCalled();
  });

  it("tells the user plainly that nothing here is filled in for them", async () => {
    await renderPage("../features/experiments/ExperimentPerformancePage");
    expect(
      await screen.findByText("Nothing here is filled in for you. Every value is one you measured or chose.")
    ).toBeTruthy();
  });
});
