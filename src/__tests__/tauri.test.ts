// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

/**
 * The three runtime states, one test each.
 *
 * They are mutually exclusive by construction, and the third — a browser with no demo flag — is
 * the one that matters most: it must fail loudly rather than quietly answering with demo records.
 */
describe("runtime routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects browser runtime when Tauri internals are absent", async () => {
    const { isTauriRuntime } = await import("../lib/tauri");
    expect(isTauriRuntime()).toBe(false);
  });

  it("detects Tauri runtime when internals are present", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const { isTauriRuntime } = await import("../lib/tauri");
    expect(isTauriRuntime()).toBe(true);
  });

  it("sends every desktop call to a real Tauri command", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValueOnce("real");
    const { invokeCommand } = await import("../lib/tauri");
    await expect(invokeCommand("demo", { id: 1 })).resolves.toBe("real");
    expect(invokeMock).toHaveBeenCalledWith("demo", { id: 1 });
  });

  it("answers from the demo adapter only when the demo flag is set", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const { invokeCommand, isDemoMode } = await import("../lib/tauri");
    expect(isDemoMode()).toBe(true);
    await expect(invokeCommand("list_base_oils", { filter: null })).resolves.toBeInstanceOf(Array);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses data operations outside Tauri when demo mode was not asked for", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    const { invokeCommand, isDemoMode } = await import("../lib/tauri");
    expect(isDemoMode()).toBe(false);
    // A refusal, not an empty list: an empty list is indistinguishable from an empty workspace.
    await expect(invokeCommand("list_base_oils", { filter: null })).rejects.toThrow(
      /app\.desktopOnly/
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses a command the demo does not implement rather than answering with nothing", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const { invokeCommand } = await import("../lib/tauri");
    await expect(invokeCommand("train_model", {})).rejects.toThrow(/train_model/);
  });
});
