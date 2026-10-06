// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// Counts every time the demo adapter is actually loaded, so a test can prove the desktop path
// never pulls it in — not merely that it did not answer.
const demoLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/demo/adapter", async (importOriginal) => {
  demoLoads.count += 1;
  return importOriginal();
});

function enterTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

/**
 * Transport selection, one runtime state at a time.
 *
 * The feature APIs never choose a backend; `lib/transport` does, and these pin what it chooses:
 * the local Tauri transport whenever the desktop shell is present, the demo transport only in an
 * explicit demo build outside it, and nothing at all otherwise.
 */
describe("transport selection", () => {
  beforeEach(() => {
    invoke.mockReset();
    demoLoads.count = 0;
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.resetModules();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.unstubAllEnvs();
  });

  it("chooses the local transport inside Tauri", async () => {
    enterTauri();
    const { selectTransportKind, resolveTransport } = await import("../lib/transport");

    expect(selectTransportKind()).toBe("local");
    expect((await resolveTransport())?.kind).toBe("local");
  });

  it("keeps the desktop on the local transport even in a demo build", async () => {
    enterTauri();
    vi.stubEnv("VITE_DEMO_MODE", "true");
    invoke.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 50 });
    const { selectTransportKind } = await import("../lib/transport");
    const { invokeCommand, isDemoMode } = await import("../lib/tauri");

    expect(selectTransportKind()).toBe("local");
    expect(isDemoMode()).toBe(false);
    await invokeCommand("list_molecules", { filter: {} });
    expect(invoke).toHaveBeenCalledWith("list_molecules", { filter: {} });
    expect(demoLoads.count).toBe(0);
  });

  it("passes the command and arguments to Tauri untouched and returns its answer", async () => {
    enterTauri();
    const args = { filter: { page: 2, pageSize: 20, element: "Zn" } };
    const answer = { items: [], total: 0, page: 2, pageSize: 20 };
    invoke.mockResolvedValueOnce(answer);
    const { resolveTransport } = await import("../lib/transport");

    const transport = await resolveTransport();
    await expect(transport?.call("list_molecules", args)).resolves.toBe(answer);
    expect(invoke).toHaveBeenCalledWith("list_molecules", args);
  });

  it("surfaces a backend failure from the local transport as it was raised", async () => {
    enterTauri();
    invoke.mockRejectedValueOnce("Failed to open SQLite database: locked");
    const { invokeCommand } = await import("../lib/tauri");

    await expect(invokeCommand("list_molecules", {})).rejects.toBe("Failed to open SQLite database: locked");
    expect(demoLoads.count).toBe(0);
  });

  it("chooses the demo transport only for an explicit demo build outside Tauri", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const { selectTransportKind, resolveTransport } = await import("../lib/transport");

    expect(selectTransportKind()).toBe("demo");
    const transport = await resolveTransport();
    expect(transport?.kind).toBe("demo");
    const page = await transport!.call<{ items: unknown[]; page: number }>("list_molecules", {
      filter: { page: 1, pageSize: 2 }
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.page).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(demoLoads.count).toBe(1);
  });

  it("chooses nothing outside Tauri without the demo flag, and refuses with the stable code", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    const { selectTransportKind, resolveTransport } = await import("../lib/transport");
    const { invokeCommand } = await import("../lib/tauri");

    expect(selectTransportKind()).toBeNull();
    await expect(resolveTransport()).resolves.toBeNull();
    await expect(invokeCommand("list_molecules", {})).rejects.toThrow(/\[app\.desktopOnly\].*\(list_molecules\)/);
    expect(invoke).not.toHaveBeenCalled();
    expect(demoLoads.count).toBe(0);
  });
});
