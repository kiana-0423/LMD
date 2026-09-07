import { expect, it, vi } from "vitest";
vi.mock("../lib/tauri", () => ({ invokeCommand: vi.fn() }));
import { invokeCommand } from "../lib/tauri";
import { explainMoleculeModel, openModelExplanation, openModelExample } from "../lib/modelExplanationApi";

it("opens and runs the isolated case without a registered model or molecule inputs", async () => {
  vi.mocked(invokeCommand).mockResolvedValueOnce(undefined);
  await openModelExample();
  expect(invokeCommand).toHaveBeenLastCalledWith("open_model_example");
  const data = { explanation: { samples: [{ id: "CCO" }] } };
  vi.mocked(invokeCommand).mockResolvedValueOnce({ data });
  expect(await explainMoleculeModel({ modelId: "rdkit_clogp", example: "rdkit_clogp", items: [] })).toBe(data);
  expect(invokeCommand).toHaveBeenLastCalledWith("explain_model_example");
});

it("opens a separate native window with the selected molecule conditions", async () => {
  vi.mocked(invokeCommand).mockResolvedValue(undefined);
  const request = { modelId: "model-1", items: [{ moleculeId: "mol-1", concentration: 1.5, concentrationUnit: "wt%", temperatureValue: 80, temperatureUnit: "C", loadValue: 100, loadUnit: "N" }] };
  await openModelExplanation(request);
  expect(invokeCommand).toHaveBeenLastCalledWith("open_model_explanation", request);
});

it("unwraps SHAP results and refuses empty explanations", async () => {
  const data = { explanation: { samples: [{ id: "one" }] } };
  vi.mocked(invokeCommand).mockResolvedValueOnce({ data });
  expect(await explainMoleculeModel({ modelId: "m", items: [] })).toBe(data);
  vi.mocked(invokeCommand).mockResolvedValueOnce({ data: { explanation: { samples: [] } } });
  await expect(explainMoleculeModel({ modelId: "m", items: [] })).rejects.toThrow("[model.explanationFailed]");
});
