// @vitest-environment jsdom

import { Modal } from "antd";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";
import { type Language } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

/**
 * Backend-produced text, rendered in Chinese and Japanese.
 *
 * The route-level language tests prove headings switch. They cannot prove anything about the
 * states that only exist once the backend has answered: a warning about excluded rows, a skipped
 * candidate, a "how this was calculated" panel, a failed job. Those were the last places English
 * survived, and they are also the places a user most needs to read.
 *
 * Every case here renders a *non-empty* backend result and asserts the translated sentence is on
 * screen and the English one is not — except where English is the user's own data, which must
 * survive untouched.
 */

const apiMock = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("../lib/api", async () => {
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
  return apiMock;
});

import AnalysisDesignPage from "../features/analysis-design/AnalysisDesignPage";
import DescriptorCenterPage from "../features/descriptors/DescriptorCenterPage";
import MoleculePerformancePredictionPage from "../features/data-mining/MoleculePerformancePredictionPage";
import MoleculeScreeningPage from "../features/data-mining/MoleculeScreeningPage";

const LANGUAGES: Language[] = ["zh-CN", "ja-JP"];

/**
 * Finds a button by its label, ignoring whitespace.
 *
 * Ant Design inserts a space between two adjacent CJK characters, so the accessible name of a
 * button labelled 训练 is "训 练". That is a rendering detail of the component library, not
 * something the translation got wrong.
 */
function buttonNamed(label: string): HTMLElement {
  const stripped = label.replace(/\s+/g, "");
  const match = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s+/g, "") === stripped);
  if (!match) throw new Error(`No button labelled ${label}`);
  return match;
}

/** The same, for text nodes whose content may carry inserted spacing. */
function textNamed(text: string): HTMLElement[] {
  const stripped = text.replace(/\s+/g, "");
  return screen.getAllByText((_, element) => {
    const content = element?.textContent ?? "";
    return content.replace(/\s+/g, "").includes(stripped);
  });
}
const catalogue = (language: Language) => messagesForLanguage(language);
const en = messagesForLanguage("en-US");

beforeEach(async () => {
  window.localStorage.clear();
  const { createApiMock } = await import("./apiMock");
  Object.assign(apiMock, createApiMock());
});

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  document
    .querySelectorAll(".ant-modal-root, .ant-modal-wrap, .ant-message-notice-wrapper")
    .forEach((node) => node.remove());
});

const METRICS = [
  {
    column: "average_friction_coefficient",
    labelCode: "metric.averageFrictionCoefficient",
    label: "Average friction coefficient",
    unit: ""
  },
  {
    column: "wear_scar_diameter_value",
    labelCode: "metric.wearScarDiameter",
    label: "Wear scar diameter",
    unit: "um"
  }
];

// --- analysis ---------------------------------------------------------------------------------

function analysisResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    metadata: {
      recordCount: 12,
      excludedCount: 2,
      field: "average_friction_coefficient",
      labelCode: "metric.averageFrictionCoefficient",
      label: "Average friction coefficient",
      unit: "dimensionless",
      methodMessage: {
        code: "analysis.methodHistogram",
        params: {},
        detail: "equal-width histogram over the observed range"
      },
      missingValueMessage: {
        code: "analysis.missingExcluded",
        params: {},
        detail: "rows without a numeric value are excluded"
      }
    },
    series: [{ binStart: 0, binEnd: 0.1, count: 7, label: "0.0000-0.1000" }],
    ...overrides
  };
}

function seedAnalysis(result: Record<string, unknown>) {
  apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
  apiMock.getPerformanceDistribution.mockResolvedValue(result);
  apiMock.comparePerformanceByGroup.mockResolvedValue(result);
  apiMock.getConcentrationPerformance.mockResolvedValue({ ...result, pearson: 0.4, spearman: 0.3 });
  apiMock.getDescriptorPropertyCorrelation.mockResolvedValue({
    ...result,
    series: [{ descriptor: "rdkit_MolWt", sampleCount: 12, pearson: 0.61, spearman: 0.55 }]
  });
}

describe("analysis panels load independently", () => {
  it("keeps correlation available when the distribution request fails", async () => {
    seedAnalysis(analysisResult());
    apiMock.getPerformanceDistribution.mockRejectedValue(new Error("[record.notFound] histogram failure"));
    renderWithLanguage(<AnalysisDesignPage />);
    expect(await screen.findByText(/histogram failure/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: catalogue("en-US")["ui.descriptorCorrelation"] }));
    expect(await screen.findByText("rdkit_MolWt")).toBeTruthy();
  });

  it("only refreshes comparison when the grouping changes", async () => {
    seedAnalysis(analysisResult({ status: "insufficient_data", series: [] }));
    renderWithLanguage(<AnalysisDesignPage />);
    const words = catalogue("en-US");
    expect(screen.queryByRole("combobox", { name: words["ui.comparisonGroup"] })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: words["ui.comparison"] }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: words["ui.comparisonGroup"] }));
    fireEvent.click(await screen.findByTitle(words["ui.baseOil"]));
    await waitFor(() => expect(apiMock.comparePerformanceByGroup).toHaveBeenLastCalledWith("base_oil", "average_friction_coefficient"));
    expect(apiMock.comparePerformanceByGroup).toHaveBeenCalledTimes(2);
    expect(apiMock.getPerformanceDistribution).toHaveBeenCalledTimes(1);
    expect(apiMock.getConcentrationPerformance).toHaveBeenCalledTimes(1);
    expect(apiMock.getDescriptorPropertyCorrelation).toHaveBeenCalledTimes(1);
  });
});

describe.each(LANGUAGES)("analysis metadata in %s", (language) => {
  const words = catalogue(language);

  it("states the method and the missing-value rule in the chosen language", async () => {
    seedAnalysis(analysisResult());

    renderWithLanguage(<AnalysisDesignPage />, language);

    await waitFor(() =>
      expect(textNamed(words["backend.analysisMethodHistogram"]).length).toBeGreaterThan(0)
    );
    expect(textNamed(words["backend.analysisMissingExcluded"]).length).toBeGreaterThan(0);
    // The English prose the backend used to send is not on screen anywhere.
    expect(screen.queryByText(/equal-width histogram/)).toBeNull();
    expect(screen.queryByText(/rows without a numeric value/)).toBeNull();
  });

  it("names the metric with the backend's key rather than its English label", async () => {
    seedAnalysis(analysisResult());

    renderWithLanguage(<AnalysisDesignPage />, language);

    await waitFor(() =>
      expect(textNamed(words["backend.analysisMethodHistogram"]).length).toBeGreaterThan(0)
    );
    // The column name is a stored identifier and stays as it is; the metric's *name* does not.
    expect(screen.getAllByText("average_friction_coefficient").length).toBeGreaterThan(0);
    expect(screen.queryByText("Average friction coefficient")).toBeNull();
  });

  it("explains an insufficient-data result with its counts", async () => {
    seedAnalysis({
      ...analysisResult(),
      status: "insufficient_data",
      series: [],
      message: {
        code: "analysis.notEnoughData",
        params: { labelCode: "metric.averageFrictionCoefficient", required: 3, available: 1 },
        detail: "Average friction coefficient needs at least 3 measured results; the workspace has 1."
      }
    });

    renderWithLanguage(<AnalysisDesignPage />, language);

    const expected = words["backend.analysisNotEnoughData"]
      .replace("{label}", words["metric.averageFrictionCoefficient"])
      .replace("{required}", "3")
      .replace("{available}", "1");
    await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0));
    // The English diagnostic is still available, but as detail rather than as the message.
    expect(screen.getAllByText(new RegExp(words["ui.diagnosticDetail"])).length).toBeGreaterThan(0);
  });

  it("warns about mixed concentration units without translating the units themselves", async () => {
    seedAnalysis({
      ...analysisResult(),
      warnings: [
        {
          code: "analysis.mixedUnits",
          params: { units: "wt%, mol%", count: 2 },
          detail: "Concentrations use more than one unit (wt%, mol%); values are plotted as stored."
        }
      ]
    });

    renderWithLanguage(<AnalysisDesignPage />, language);

    const expected = words["backend.analysisMixedUnits"]
      .replace("{count}", "2")
      .replace("{units}", "wt%, mol%");
    await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0));
  });

  it("renders a correlation table with translated headers and untouched descriptor names", async () => {
    seedAnalysis(analysisResult());

    renderWithLanguage(<AnalysisDesignPage />, language);

    fireEvent.click(await screen.findByRole("tab", { name: words["ui.descriptorCorrelation"] }));

    // A descriptor name is a column in the user's data and is never translated.
    expect(await screen.findByText("rdkit_MolWt")).toBeTruthy();
    expect(screen.getAllByText(words["ui.samples"]).length).toBeGreaterThan(0);
  });

  it("shows a failed analysis as a translated summary beside its diagnostic", async () => {
    apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
    apiMock.getPerformanceDistribution.mockRejectedValue(
      new Error("[record.notFound] Metric not found: bogus_column")
    );

    renderWithLanguage(<AnalysisDesignPage />, language);

    await waitFor(() =>
      expect(screen.getAllByText(words["error.recordNotFound"]).length).toBeGreaterThan(0)
    );
    // The identifier in the diagnostic survives untranslated, because it is what the user acts on.
    expect(screen.getAllByText(/bogus_column/).length).toBeGreaterThan(0);
  });
});

// --- prediction -------------------------------------------------------------------------------

const MODEL = {
  id: "model-1",
  name: "Friction model",
  target: "average_friction_coefficient",
  task: "regression",
  algorithm: "ridge",
  modelVersion: "1",
  featureOrder: ["rdkit_MolWt", "concentration"],
  metrics: {},
  sampleCount: 24,
  featureCount: 2,
  trainedAt: "2026-01-01",
  splitMethod: "GroupShuffleSplit(test_size=0.25, random_state=42) grouped by formulation",
  splitMethodMessage: {
    code: "split.grouped",
    params: {},
    detail: "GroupShuffleSplit(test_size=0.25, random_state=42) grouped by formulation"
  },
  datasetMode: "additive_component" as const,
  interpretation: "One row per additive component per measured result.",
  interpretationCode: "dataset.interpretationAdditive",
  groupCount: 12,
  validated: true,
  featureSchemaVersion: "4",
  concentrationBasis: "wt%",
  usable: true
};

function seedPrediction() {
  apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
  apiMock.listModels.mockResolvedValue([MODEL]);
  apiMock.listMoleculePage.mockResolvedValue({
    items: [
      { id: "mol-1", name: "ZDDP" },
      { id: "mol-2", name: "MoDTC" }
    ],
    total: 2,
    page: 1,
    pageSize: 200
  });
}

describe.each(LANGUAGES)("prediction results in %s", (language) => {
  const words = catalogue(language);

  it("explains a skipped candidate in the chosen language, keeping its name", async () => {
    seedPrediction();
    apiMock.predictMoleculePerformance.mockResolvedValue({
      modelId: "model-1",
      modelName: "Friction model",
      target: "average_friction_coefficient",
      algorithm: "ridge",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      datasetMode: "additive_component",
      concentrationBasis: "wt%",
      metrics: {},
      predictions: [{ id: "mol-1", label: "ZDDP", value: 0.061 }],
      skipped: [
        {
          id: "mol-2",
          label: "MoDTC",
          reason: "Real RDKit and Mordred descriptors have not been calculated for MoDTC.",
          reasonMessage: {
            code: "skipped.noDescriptors",
            params: { subject: "MoDTC", missingCount: 2 },
            detail: "Real RDKit and Mordred descriptors have not been calculated for MoDTC."
          }
        }
      ]
    });

    renderWithLanguage(<MoleculePerformancePredictionPage />, language);

    fireEvent.click(screen.getByRole("tab", { name: words["model.modelsTitle"] }));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("tab", { name: words["model.predictTitle"] }));
    const picker = await screen.findByRole("combobox", {
      name: words["model.selectMoleculesToPredict"]
    });
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByTitle("ZDDP"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1.5" } });
    fireEvent.click(buttonNamed(words["model.predict"]));

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
    const expected = words["backend.skippedNoDescriptors"].replace("{subject}", "MoDTC");
    expect(await screen.findByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    // The molecule's own name is data and is shown exactly as recorded.
    expect(screen.getAllByText("MoDTC").length).toBeGreaterThan(0);
  });

  it("states the validation split and the dataset interpretation in the chosen language", async () => {
    seedPrediction();
    apiMock.trainModel.mockResolvedValue({
      modelId: "model-1",
      target: "average_friction_coefficient",
      label: "Average friction coefficient",
      unit: "",
      algorithm: "ridge",
      modelVersion: "1",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      excludedCount: 3,
      featureCount: 2,
      featureOrder: [],
      droppedFeatures: [],
      metrics: { validation: { sample_count: 6, r2: 0.8, mae: 0.01, rmse: 0.02 } },
      splitMethod: MODEL.splitMethod,
      splitMethodMessage: MODEL.splitMethodMessage,
      groupCount: 12,
      validated: true,
      datasetMode: "additive_component",
      interpretation: MODEL.interpretation,
      interpretationCode: MODEL.interpretationCode,
      featureSchemaVersion: "4",
      concentrationBasis: "wt%",
      multiAdditiveResultCount: 4,
      resultCount: 24,
      excludedForUnits: 3,
      datasetReport: {
        excludedNonphysical: 1,
        warnings: [
          {
            code: "dataset.excludedOtherBasis",
            params: { count: 3, excluded: "unrecorded", chosen: "wt%" },
            detail: "3 record(s) recorded concentrations as 'unrecorded'."
          }
        ]
      },
      warnings: [
        {
          code: "training.smallSample",
          params: { available: 14, required: 20 },
          detail: "Only 14 records were available."
        }
      ]
    });

    renderWithLanguage(<MoleculePerformancePredictionPage />, language);
    await screen.findByRole("radio", { hidden: true });
    fireEvent.click(buttonNamed(words["model.train"]));

    // The training warning, the exclusion warning, the interpretation, and the split method are
    // four separate backend-produced strings, and all four are rendered from codes.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          words["backend.trainingSmallSample"].replace("{available}", "14").replace("{required}", "20")
        ).length
      ).toBeGreaterThan(0)
    );
    expect(
      screen.getAllByText(words["backend.interpretationAdditive"]).length
    ).toBeGreaterThan(0);
    const exclusion = words["backend.datasetExcludedOtherBasis"]
      .replace("{count}", "3")
      .replace("{excluded}", words["model.basisUnrecorded"])
      .replace("{chosen}", words["model.basisMass"]);
    expect(screen.getAllByText(exclusion).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(new RegExp(words["backend.splitGrouped"])).length
    ).toBeGreaterThan(0);
    // Nothing English survived from any of them.
    expect(screen.queryByText(/Only 14 records were available/)).toBeNull();
    expect(screen.queryByText(/One row per additive component/)).toBeNull();
    expect(screen.queryByText(/GroupShuffleSplit/)).toBeNull();
  });

  it("reports a failed training run as a translated summary beside its diagnostic", async () => {
    seedPrediction();
    apiMock.trainModel.mockRejectedValue(
      new Error("[model.notEnoughData] Training needs at least 12 rows; this workspace provides 4.")
    );

    renderWithLanguage(<MoleculePerformancePredictionPage />, language);
    await screen.findByRole("radio", { hidden: true });
    fireEvent.click(buttonNamed(words["model.train"]));

    await waitFor(() =>
      expect(screen.getAllByText(words["error.modelNotEnoughData"]).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/this workspace provides 4/).length).toBeGreaterThan(0);
    // The bracketed code itself must never reach the screen.
    expect(screen.queryByText(/\[model\.notEnoughData\]/)).toBeNull();
  });
});

// --- screening --------------------------------------------------------------------------------

describe.each(LANGUAGES)("screening states in %s", (language) => {
  const words = catalogue(language);

  it("asks for a concentration using the shared policy's wording", async () => {
    apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
    apiMock.listModels.mockResolvedValue([MODEL]);
    apiMock.listMoleculePage.mockResolvedValue({
      items: [{ id: "mol-1", name: "ZDDP" }],
      total: 1,
      page: 1,
      pageSize: 200
    });

    renderWithLanguage(<MoleculeScreeningPage />, language);

    expect(await screen.findByText(words["concentration.massHelp"])).toBeTruthy();
    expect(screen.queryByText(en["concentration.massHelp"])).toBeNull();
  });

  it("names every candidate it could not rank, in the chosen language", async () => {
    apiMock.listPerformanceMetrics.mockResolvedValue(METRICS);
    apiMock.listModels.mockResolvedValue([MODEL]);
    apiMock.listMoleculePage.mockResolvedValue({
      items: [{ id: "mol-1", name: "ZDDP" }],
      total: 1,
      page: 1,
      pageSize: 200
    });
    apiMock.predictMoleculePerformance.mockResolvedValue({
      modelId: "model-1",
      modelName: "Friction model",
      target: "average_friction_coefficient",
      algorithm: "ridge",
      trainedAt: "2026-01-01",
      sampleCount: 24,
      datasetMode: "additive_component",
      concentrationBasis: "wt%",
      metrics: {},
      predictions: [],
      skipped: [
        {
          id: "mol-1",
          label: "ZDDP",
          reason: "'ZDDP' records concentrations as 'wt%'.",
          reasonMessage: {
            code: "concentration.basisMismatch",
            params: { subject: "ZDDP", found: "wt%", expected: "none" },
            detail: "'ZDDP' records concentrations as 'wt%'."
          }
        }
      ]
    });

    renderWithLanguage(<MoleculeScreeningPage />, language);
    fireEvent.change(
      await screen.findByLabelText(`${words["concentration.massLabel"]} 1`),
      { target: { value: "1" } }
    );
    fireEvent.click(
      screen
        .getAllByRole("button")
        .find((button) =>
          (button.textContent ?? "").replace(/\s+/g, "").includes(words["screening.run"].replace(/\s+/g, ""))
        ) as HTMLElement
    );

    await waitFor(() => expect(apiMock.predictMoleculePerformance).toHaveBeenCalled());
    const expected = words["backend.concentrationBasisMismatch"]
      .replace("{subject}", "ZDDP")
      .replace("{found}", words["model.basisMass"])
      .replace("{expected}", words["model.basisNone"]);
    expect(await screen.findByText(new RegExp(expected.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    expect(screen.getByText(words["screening.allSkippedTitle"])).toBeTruthy();
  });
});

// --- job history ------------------------------------------------------------------------------

describe.each(LANGUAGES)("job status panel in %s", (language) => {
  const words = catalogue(language);

  it("translates a job's failure and keeps its diagnostic", async () => {
    apiMock.listMoleculePage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 7 });
    apiMock.listMoleculeDescriptors.mockResolvedValue([]);
    apiMock.listDescriptorsForMolecules.mockResolvedValue([]);
    apiMock.listDescriptorJobs.mockResolvedValue([
      {
        id: "job-1",
        status: "failed",
        totalCount: 12,
        successCount: 0,
        failedCount: 12,
        createdAt: "2026-01-01T00:00:00Z",
        errorMessage: "[concentration.unusable] Formulation form-03 records concentrations in mol%."
      }
    ]);

    renderWithLanguage(<DescriptorCenterPage />, language);

    await waitFor(() =>
      expect(screen.getAllByText(words["error.concentrationUnusable"]).length).toBeGreaterThan(0)
    );
    // The record's id and the unit it recorded are the user's data and stay exactly as stored.
    expect(screen.getAllByText(/form-03/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[concentration\.unusable\]/)).toBeNull();
  });
});
