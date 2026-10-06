import { coded } from "./backendErrors";
import { isDemoBuild, isTauriRuntime, resolveTransport, selectTransportKind } from "./transport";

/**
 * The one place a feature API call is dispatched, and the one place demo data can enter.
 *
 * There used to be an `invokeOrMock(command, args, fallback)` helper, and every API module passed
 * it a fallback that produced fabricated records. That made the browser demo work — and it also
 * meant `api.mock.ts` and `mockData.ts` were statically imported by the desktop bundle, reachable
 * from every screen. A desktop build that failed to reach the backend for any reason would not
 * report the failure: it would quietly answer with invented molecules, and nothing on screen would
 * distinguish them from the user's own.
 *
 * So there are now exactly three states, and they are mutually exclusive:
 *
 *   * **Desktop** — inside Tauri. Every call goes to the local transport, a real command. Demo
 *     data is unreachable.
 *   * **Explicit demo** — outside Tauri, built with `VITE_DEMO_MODE=true`. Calls are answered by
 *     the demo transport, which is loaded on demand and only exists in a demo build.
 *   * **Anything else** — outside Tauri, without the flag. Calls fail with a stable code. This is
 *     the important one: a clear refusal is honest, and invented data is not.
 *
 * Choosing among them is `lib/transport`'s job; this module keeps the call signature every feature
 * API already uses and the refusal it has always raised.
 */

export { isDemoBuild, isTauriRuntime };

/** True when calls will be answered by the demo adapter rather than by the backend. */
export function isDemoMode() {
  return selectTransportKind() === "demo";
}

/** Stable code for "this needs the desktop application". */
export const DESKTOP_ONLY_CODE = "app.desktopOnly";

const DESKTOP_ONLY_DETAIL =
  "This operation reads or writes the workspace database, which only the desktop application has.";

/**
 * Runs a backend command through this runtime's transport, or refuses.
 *
 * `args` is passed through untouched, so a command's parameters stay where they are declared.
 */
export async function invokeCommand<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const transport = await resolveTransport();
  if (!transport) {
    throw new Error(coded(DESKTOP_ONLY_CODE, `${DESKTOP_ONLY_DETAIL} (${command})`));
  }
  return transport.call<T>(command, args);
}

/** Raises the standard refusal, for callers that decide before they build a request. */
export function refuseOutsideDesktop(detail = DESKTOP_ONLY_DETAIL): never {
  throw new Error(coded(DESKTOP_ONLY_CODE, detail));
}
