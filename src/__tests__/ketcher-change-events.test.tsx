// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithLanguage } from "./renderWithLanguage";

const fake = vi.hoisted(() => ({
  getSmiles: vi.fn(), getMolfile: vi.fn(), setMolecule: vi.fn(),
  editor: { subscribe: vi.fn(), unsubscribe: vi.fn() }
}));
vi.mock("ketcher-react", () => ({ Editor: ({ onInit }: { onInit: (value: unknown) => void }) =>
  <button onClick={() => onInit(fake)}>Initialize editor</button> }));
vi.mock("ketcher-standalone/dist/binaryWasmNoRender", () => ({ StandaloneStructServiceProvider: class {} }));
vi.mock("../features/molecule-sketcher/KetcherTranslationBridge", () => ({ default: () => null }));
import KetcherEditor, { type KetcherEditorHandle } from "../features/molecule-sketcher/KetcherEditor";

let changed: () => void;
const token = { handler: "subscription" };
beforeEach(() => {
  fake.getSmiles.mockReset().mockResolvedValue("CCO");
  fake.getMolfile.mockReset().mockResolvedValue("\n  RDKit\n\nMOL\n");
  fake.setMolecule.mockReset().mockResolvedValue(undefined);
  fake.editor.unsubscribe.mockReset();
  fake.editor.subscribe.mockReset().mockImplementation((_event, handler) => { changed = handler; return token; });
});
afterEach(cleanup);

it("subscribes to canvas edits, preserves MOL headers and unsubscribes on unmount", async () => {
  const onChange = vi.fn();
  const onEdit = vi.fn();
  const onReady = vi.fn();
  const rendered = renderWithLanguage(<KetcherEditor onChange={onChange} onEdit={onEdit} onReady={onReady} />);
  fireEvent.click(screen.getByText("Initialize editor"));
  expect(onReady).toHaveBeenCalledWith(true);
  act(() => { changed(); changed(); });
  expect(onEdit).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ smiles: "CCO", molfile: "\n  RDKit\n\nMOL\n" }));
  expect(fake.getSmiles).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(fake.editor.unsubscribe).toHaveBeenCalledWith("change", token);
  expect(onReady).toHaveBeenLastCalledWith(false);
});

it("ignores an older asynchronous structure read after another edit", async () => {
  let finish!: (smiles: string) => void;
  fake.getSmiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const onChange = vi.fn();
  renderWithLanguage(<KetcherEditor onChange={onChange} />);
  fireEvent.click(screen.getByText("Initialize editor"));
  act(() => changed());
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fake.getSmiles.mockResolvedValue("CCN");
  act(() => changed());
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ smiles: "CCN" })));
  await act(async () => finish("CCO"));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("does not silently accept imports before the editor is ready", async () => {
  const ref = createRef<KetcherEditorHandle>();
  renderWithLanguage(<KetcherEditor ref={ref} />);
  await expect(ref.current!.setMolecule("MOL", "molfile")).rejects.toThrow("Ketcher is not ready");
  fireEvent.click(screen.getByText("Initialize editor"));
  await act(async () => ref.current!.setMolecule("\nMOL", "molfile"));
  expect(fake.setMolecule).toHaveBeenCalledWith("\nMOL");
});
