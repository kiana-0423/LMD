#!/usr/bin/env node
/**
 * Keeps the Tauri command surface honest in both directions.
 *
 * A command the frontend calls but Rust does not register fails at runtime, in the packaged
 * application, with a message a user cannot act on. A command Rust registers but nothing calls is
 * the opposite problem: it is reachable from the webview, it is never exercised by any test that
 * matters, and every one of them is attack surface kept alive by nothing but inertia.
 *
 * The invoke surface should be as small as the application actually needs, so this fails on both.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractDemoCommands,
  extractInvokedCommands,
  extractRegisteredCommands
} from "./command-scan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Commands registered in Rust that no frontend module calls, with why each is kept.
 *
 * Every entry needs a reason. "It might be useful later" is not one — an unused command can be
 * deleted and written again, and until then it is surface nobody is testing.
 */
const INTENTIONALLY_UNCALLED = new Map([
  [
    "initialize_database",
    "Called by the Rust startup path; exposed so a support session can re-run it on a workspace that failed to open."
  ],
  [
    "create_default_directories",
    "As above: repairs a workspace whose folders were removed underneath it."
  ]
]);

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(path)) found.push(path);
  }
  return found;
}

/** Every command name the frontend asks Tauri to run, with the file it is asked from. */
function invokedCommands() {
  const found = new Map();
  for (const path of walk(join(ROOT, "src"))) {
    // Tests name commands to assert on them; that is not the application calling them.
    if (path.includes("__tests__")) continue;
    for (const command of extractInvokedCommands(readFileSync(path, "utf8"))) {
      const files = found.get(command) ?? [];
      files.push(relative(ROOT, path));
      found.set(command, files);
    }
  }
  return found;
}

function registeredCommands() {
  return extractRegisteredCommands(readFileSync(join(ROOT, "src-tauri/src/main.rs"), "utf8"));
}

function demoCommands() {
  return new Set(extractDemoCommands(readFileSync(join(ROOT, "src/lib/demo/adapter.ts"), "utf8")));
}

const invoked = invokedCommands();
const registered = registeredCommands();
const registeredSet = new Set(registered);
const problems = [];

for (const [command, files] of invoked) {
  if (!registeredSet.has(command)) {
    problems.push(`${command} is invoked from ${files.join(", ")} but no Rust handler is registered`);
  }
}

for (const command of registered) {
  if (invoked.has(command)) continue;
  if (INTENTIONALLY_UNCALLED.has(command)) continue;
  problems.push(
    `${command} is registered in main.rs but nothing calls it. Wire it into the interface, delete ` +
      "it, or record why it is kept in INTENTIONALLY_UNCALLED."
  );
}

const duplicates = registered.filter((command, index) => registered.indexOf(command) !== index);
if (duplicates.length) {
  problems.push(`registered twice in main.rs: ${[...new Set(duplicates)].join(", ")}`);
}

// A demo answer for a command the backend does not have is dead weight that will be maintained
// forever because nobody can tell it is dead.
for (const command of demoCommands()) {
  if (!registeredSet.has(command)) {
    problems.push(`the demo adapter answers ${command}, which is not a registered Tauri command`);
  }
}

if (problems.length) {
  process.stderr.write("Tauri command surface problems:\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `ok   ${registered.length} registered commands, ${invoked.size} invoked, none unused or missing\n`
);
