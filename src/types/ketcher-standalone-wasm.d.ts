/**
 * Types for the separate-asset Indigo entry.
 *
 * `ketcher-standalone` declares types for its default entry only; `dist/binaryWasmNoRender`
 * exports the same `StandaloneStructServiceProvider` from the same source, built with the WASM as
 * a separate file rather than a Base64 string. Re-exporting the declared type keeps the editor's
 * call site type-checked instead of falling back to `any`.
 */
declare module "ketcher-standalone/dist/binaryWasmNoRender" {
  export * from "ketcher-standalone";
}
