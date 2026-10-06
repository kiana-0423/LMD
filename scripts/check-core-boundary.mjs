#!/usr/bin/env node
/**
 * Fails when `lmd-core` can reach the desktop host through its dependencies.
 *
 * `crates/lmd-core` holds the use cases a headless server will share with the desktop application.
 * It stays host-independent because it cannot name Tauri at all: Tauri is not in its dependency
 * graph, so code that reaches for an `AppHandle` does not compile. That guarantee lasts exactly as
 * long as the graph stays clean, and one added dependency — directly or through some other crate —
 * would end it without any source file changing.
 *
 * So this reads the graph Cargo actually resolves for the crate (normal, build and dev edges) and
 * fails on any desktop-runtime package in it, or on a dependency back onto the desktop crate.
 */

import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "lmd-core";
const DESKTOP_CRATE = "lubricant-materials-database";

/**
 * Packages that only exist to host a desktop window: Tauri and its plugins, its build helper, and
 * the webview, windowing and native-menu crates beneath it.
 */
const DESKTOP_PACKAGE =
  /^(tauri(-.*)?|wry|tao|muda|tray-icon|webview2-com(-.*)?|webkit2gtk(-.*)?|javascriptcore-rs(-.*)?|gtk(-.*)?|gdk(-.*)?|objc2?(-.*)?|cocoa(-.*)?|window-vibrancy)$/;

let output;
try {
  output = execFileSync(
    "cargo",
    [
      "tree",
      "--manifest-path",
      join(ROOT, "src-tauri", "Cargo.toml"),
      "--package",
      CORE,
      "--locked",
      "--edges",
      "normal,build,dev",
      "--prefix",
      "none",
      "--format",
      "{p}"
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (error) {
  process.stderr.write(`Could not resolve the ${CORE} dependency graph with cargo tree:\n`);
  process.stderr.write(`${error.stderr || error.message}\n`);
  process.exit(1);
}

const packages = new Set(
  output
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
);

if (!packages.has(CORE)) {
  process.stderr.write(`cargo tree did not report ${CORE}; the check would pass for the wrong reason.\n`);
  process.exit(1);
}

const problems = [...packages]
  .filter((name) => name === DESKTOP_CRATE || DESKTOP_PACKAGE.test(name))
  .sort();

if (problems.length) {
  process.stderr.write(`${CORE} depends on the desktop host:\n`);
  for (const name of problems) {
    process.stderr.write(
      `  - ${name} (find the path with: cargo tree --manifest-path src-tauri/Cargo.toml -p ${CORE} -i ${name})\n`
    );
  }
  process.exit(1);
}

process.stdout.write(`ok   ${CORE} resolves ${packages.size - 1} dependencies, none of them desktop-only\n`);
