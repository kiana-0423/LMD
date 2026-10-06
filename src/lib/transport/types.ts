/**
 * How a feature API call reaches a backend.
 *
 * A call is a command name and its arguments — the same names the Rust side registers — and the
 * answer is the command's response, unchanged. Every transport honours that contract, so the
 * feature modules in `lib/api/` never know which one answered them.
 *
 * Only the transports that work today are listed. A remote transport belongs here once there is
 * a server to answer it; until then a kind that cannot answer would only be a way to fail later.
 */
export type TransportKind =
  /** The Tauri desktop shell, reading and writing the local workspace. */
  | "local"
  /** The browser demo, answering from fabricated records. Only exists in a demo build. */
  | "demo";

export interface CommandTransport {
  readonly kind: TransportKind;
  /** Runs one command. Failures are the backend's own errors, passed through untouched. */
  call<T>(command: string, args: Record<string, unknown>): Promise<T>;
}
