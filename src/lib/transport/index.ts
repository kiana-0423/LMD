import { isTauriRuntime, localTransport } from "./local";
import type { CommandTransport, TransportKind } from "./types";

export type { CommandTransport, TransportKind } from "./types";
export { isTauriRuntime } from "./local";

/** True when this build was made with the browser-demo flag. */
export function isDemoBuild() {
  return import.meta.env.VITE_DEMO_MODE === "true";
}

/**
 * Which transport answers calls in this runtime, or `null` when none may.
 *
 * The desktop shell always wins: inside Tauri the demo is unreachable, even in a demo build. And
 * there is no fallback — outside Tauri without the demo flag nothing answers, so the caller can
 * refuse plainly instead of showing invented records.
 */
export function selectTransportKind(): TransportKind | null {
  if (isTauriRuntime()) return "local";
  if (isDemoBuild()) return "demo";
  return null;
}

/**
 * The transport for this runtime, loaded if it has to be.
 *
 * The demo flag is compared against a literal so the bundler can fold the branch away. In a build
 * without `VITE_DEMO_MODE=true` the demo import below is unreachable and is dropped, which is what
 * keeps the desktop bundle free of mock datasets. This is the only module that reaches the demo
 * adapter.
 */
export async function resolveTransport(): Promise<CommandTransport | null> {
  const kind = selectTransportKind();
  if (kind === "local") return localTransport;
  if (kind === "demo" && import.meta.env.VITE_DEMO_MODE === "true") {
    const { dispatchDemoCommand } = await import("../demo/adapter");
    return { kind: "demo", call: dispatchDemoCommand };
  }
  return null;
}
