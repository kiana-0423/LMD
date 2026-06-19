// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

describe("tauri helpers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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

  it("uses mock fallback outside Tauri", async () => {
    const { invokeOrMock } = await import("../lib/tauri");
    await expect(invokeOrMock("demo", {}, async () => "fallback")).resolves.toBe("fallback");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes Tauri command inside Tauri runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValueOnce("real");
    const { invokeOrMock } = await import("../lib/tauri");
    await expect(invokeOrMock("demo", { id: 1 }, async () => "fallback")).resolves.toBe("real");
    expect(invokeMock).toHaveBeenCalledWith("demo", { id: 1 });
  });
});
