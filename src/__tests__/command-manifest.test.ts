import { describe, expect, it } from "vitest";

// Vite inlines these at transform time, so the test reads the real sources — the API layer and the
// Rust command registry — without needing Node filesystem access.
import mainRs from "../../src-tauri/src/main.rs?raw";

const apiSources = import.meta.glob("../lib/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/**
 * Every command name the frontend asks Tauri to run.
 *
 * Both call shapes are covered: `invokeCommand("name", …)` and a direct `invoke<T>("name", …)`,
 * with or without a type argument and across line breaks.
 */
function invokedCommands(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  // The optional type argument may itself be generic (`invokeCommand<Envelope<T>>`), so the match
  // runs up to the call parenthesis rather than the first `>`.
  const call = /\binvoke(?:Command)?\s*(?:<[^;()]*>)?\s*\(\s*["'`]([a-z][a-z0-9_]*)["'`]/g;
  for (const [file, source] of Object.entries(apiSources)) {
    for (const match of source.matchAll(call)) {
      const command = match[1];
      found.set(command, [...(found.get(command) ?? []), file]);
    }
  }
  return found;
}

/** Every command registered in `tauri::generate_handler!`. */
function registeredCommands(): Set<string> {
  const block = mainRs.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("main.rs no longer contains a generate_handler! block");
  return new Set(
    block[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split("::").pop() as string)
  );
}

describe("frontend and backend command manifest", () => {
  it("finds the commands both sides declare", () => {
    // A guard on the guard: if either scan silently returned nothing, every assertion below would
    // pass for the wrong reason.
    expect(invokedCommands().size).toBeGreaterThan(20);
    expect(registeredCommands().size).toBeGreaterThan(20);
  });

  it("registers a Tauri handler for every command the frontend invokes", () => {
    const registered = registeredCommands();
    const missing = [...invokedCommands().entries()]
      .filter(([command]) => !registered.has(command))
      .map(([command, files]) => `${command} (invoked from ${files.join(", ")})`);

    // A command with no handler fails only at runtime, in the packaged application, with a message
    // the user cannot act on. It has to fail here instead.
    expect(missing, "commands invoked by the frontend with no registered Rust handler").toEqual([]);
  });

  it("registers exactly one attachment delete, used by every entity", () => {
    const registered = registeredCommands();
    const deletes = [...registered].filter((command) => /^delete_.*attachment/.test(command));

    expect(deletes).toEqual(["delete_attachment_record"]);
    // The unsafe legacy commands must not come back.
    expect(registered.has("delete_attachment")).toBe(false);
    expect(registered.has("delete_molecule_attachment")).toBe(false);
  });

  it("keeps the two prediction commands separate so a request cannot address the wrong model", () => {
    const registered = registeredCommands();

    expect(registered.has("predict_molecule_performance")).toBe(true);
    expect(registered.has("predict_formulation_performance")).toBe(true);
    // A single ambiguous command is what allowed a molecule-level model to answer a
    // formulation-level question.
    expect(registered.has("predict_with_model")).toBe(false);
  });
});
