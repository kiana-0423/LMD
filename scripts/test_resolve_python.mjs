#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolvePython } from "./resolve-python.mjs";

const suffix = process.platform === "win32" ? ".exe" : "";
const selected = `python${suffix}`;
const system = `python3.12${suffix}`;

/** Simulates setup-python's PATH interpreter alongside a separate system Python installation. */
function probe(command, args) {
  if (command !== selected && command !== system) return null;
  return {
    command,
    args,
    version: [3, command === selected ? 11 : 12, 0],
    versionText: command === selected ? "3.11.0" : "3.12.0"
  };
}

const resolved = resolvePython({}, probe);
assert.equal(resolved.command, selected);
assert.equal(resolved.source, "python");

const explicit = resolvePython({ LMD_PYTHON: "/opt/lmd/python" }, (command, args) => ({
  command,
  args,
  version: [3, 11, 0],
  versionText: "3.11.0"
}));
assert.equal(explicit.command, "/opt/lmd/python");
assert.equal(explicit.source, "LMD_PYTHON");

console.log("ok   the PATH-selected Python wins over unrelated versioned installations");
