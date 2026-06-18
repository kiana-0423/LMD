import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeOrMock<T>(command: string, args: Record<string, unknown>, mock: () => Promise<T>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }
  return mock();
}
