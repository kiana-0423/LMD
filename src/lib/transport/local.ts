import { invoke } from "@tauri-apps/api/core";
import type { CommandTransport } from "./types";

/** True when the application is running inside the Tauri desktop shell. */
export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Commands answered by the Rust backend over Tauri IPC, against the local workspace. */
export const localTransport: CommandTransport = {
  kind: "local",
  call<T>(command: string, args: Record<string, unknown>) {
    return invoke<T>(command, args);
  }
};
