#!/usr/bin/env node
/**
 * Finds a Python interpreter this repository can build and test the sidecar with.
 *
 * The npm scripts used to run `python scripts/build_sidecar.py`. On macOS there is no `python` —
 * only `python3` — so `npm run tauri dev` failed before it started, with an error about a missing
 * command rather than about the thing that was actually missing. Writing `python3` instead moves
 * the same failure to Windows, where the launcher is `py`.
 *
 * So the interpreter is *resolved* rather than assumed, in the order a developer would try things:
 *
 *   1. `LMD_PYTHON`          — an explicit choice for this project, which wins over everything.
 *   2. `PYTHON`              — the conventional override, respected by many toolchains.
 *   3. `CONDA_PREFIX`        — the environment that is already active, which is where RDKit
 *                              usually lives on a scientific machine.
 *   4. A project-local venv  — `.venv` or `python-sidecar/.venv`.
 *   5. `py -3.11` on Windows — the launcher, asked for a version this project supports.
 *   6. `python3.12` / `python3.11` / `python3.10` — a specific version, newest first.
 *   7. `python3`, then `python` — whatever they happen to be, accepted only if compatible.
 *
 * Every candidate is *executed* to read its version. A name on PATH proves nothing: `python3` is
 * 3.9 on a stock macOS, and RDKit does not support it.
 *
 * Usage:
 *   node scripts/resolve-python.mjs                 print the resolved interpreter
 *   node scripts/resolve-python.mjs script.py ...   run a script with it
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The versions the sidecar supports.
 *
 * The lower bound is RDKit's; the upper bound is the newest interpreter the pinned wheels are
 * built for. Keep this in step with `requires-python` in python-sidecar/pyproject.toml and with
 * `ensure_build_environment` in scripts/build_sidecar.py — the three are asserted equal by
 * scripts/check_python_requirements.py.
 */
export const MINIMUM_VERSION = [3, 10];
export const MAXIMUM_VERSION_EXCLUSIVE = [3, 13];

const IS_WINDOWS = process.platform === "win32";
const EXECUTABLE_SUFFIX = IS_WINDOWS ? ".exe" : "";

/** Runs a candidate and reads the version it reports, or `null` if it is not usable. */
export function probeInterpreter(command, args = []) {
  let result;
  try {
    result = spawnSync(command, [...args, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], {
      encoding: "utf8",
      // A missing interpreter must be a `null`, not a thrown error that stops the search.
      windowsHide: true
    });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  const printed = (result.stdout ?? "").trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(printed);
  if (!match) return null;
  const version = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { command, args, version, versionText: printed };
}

/** True when a probed version falls inside the supported range. */
export function isSupported(version) {
  const [major, minor] = version;
  const [minMajor, minMinor] = MINIMUM_VERSION;
  const [maxMajor, maxMinor] = MAXIMUM_VERSION_EXCLUSIVE;
  if (major < minMajor || (major === minMajor && minor < minMinor)) return false;
  if (major > maxMajor || (major === maxMajor && minor >= maxMinor)) return false;
  return true;
}

/** The interpreter inside a virtual environment or Conda prefix, whatever the platform calls it. */
function interpreterInPrefix(prefix) {
  const candidates = IS_WINDOWS
    ? [join(prefix, "python.exe"), join(prefix, "Scripts", "python.exe")]
    : [join(prefix, "bin", "python3"), join(prefix, "bin", "python")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Every candidate, in the order the module documentation describes. */
export function candidates(environment = process.env) {
  const list = [];
  const push = (command, args = [], source = "") => {
    if (command) list.push({ command, args, source });
  };

  push(environment.LMD_PYTHON, [], "LMD_PYTHON");
  push(environment.PYTHON, [], "PYTHON");

  if (environment.CONDA_PREFIX) {
    push(interpreterInPrefix(environment.CONDA_PREFIX), [], "CONDA_PREFIX");
  }
  if (environment.VIRTUAL_ENV) {
    push(interpreterInPrefix(environment.VIRTUAL_ENV), [], "VIRTUAL_ENV");
  }
  for (const relative of [".venv", join("python-sidecar", ".venv")]) {
    push(interpreterInPrefix(join(REPOSITORY_ROOT, relative)), [], `${relative}`);
  }

  if (IS_WINDOWS) {
    // Newest supported first: the launcher will happily give 3.13 for a bare `py -3`.
    for (const version of ["3.12", "3.11", "3.10"]) {
      push("py", [`-${version}`], `py -${version}`);
    }
  }
  for (const version of ["3.12", "3.11", "3.10"]) {
    push(`python${version}${EXECUTABLE_SUFFIX}`, [], `python${version}`);
  }
  push(`python3${EXECUTABLE_SUFFIX}`, [], "python3");
  push(`python${EXECUTABLE_SUFFIX}`, [], "python");
  return list;
}

/** The first candidate that runs and reports a supported version. */
export function resolvePython(environment = process.env) {
  const rejected = [];
  for (const candidate of candidates(environment)) {
    const probed = probeInterpreter(candidate.command, candidate.args);
    if (!probed) continue;
    if (!isSupported(probed.version)) {
      rejected.push(`${candidate.source || candidate.command}: Python ${probed.versionText}`);
      continue;
    }
    return { ...probed, source: candidate.source, rejected };
  }
  return { rejected };
}

/** What to print when nothing usable was found. */
export function unavailableMessage(rejected) {
  const [minMajor, minMinor] = MINIMUM_VERSION;
  const [, maxMinor] = MAXIMUM_VERSION_EXCLUSIVE;
  const supported = `${minMajor}.${minMinor}-${minMajor}.${maxMinor - 1}`;
  const lines = [
    `No usable Python found. LMD's scientific sidecar needs Python ${supported}.`,
    ""
  ];
  if (rejected.length) {
    lines.push("Interpreters that were found but are the wrong version:");
    for (const entry of rejected) lines.push(`  - ${entry}`);
    lines.push("");
  }
  lines.push(
    "Install one, then either activate it or point LMD at it:",
    "",
    "  macOS      brew install python@3.11",
    "  Windows    winget install Python.Python.3.11",
    "  Linux      apt install python3.11 python3.11-venv",
    "  Conda      conda create -n lmd python=3.11 && conda activate lmd",
    "",
    "  Any OS     LMD_PYTHON=/full/path/to/python npm run tauri dev",
    "",
    "Then install the sidecar's dependencies:",
    "  <python> -m pip install -r python-sidecar/requirements.lock"
  );
  return lines.join("\n");
}

function main() {
  const forwarded = process.argv.slice(2);
  const resolved = resolvePython();
  if (!resolved.command) {
    process.stderr.write(`${unavailableMessage(resolved.rejected ?? [])}\n`);
    process.exit(1);
  }

  const label = resolved.source ? ` (from ${resolved.source})` : "";
  if (forwarded.length === 0) {
    process.stderr.write(`LMD: using Python ${resolved.versionText}${label}: ${resolved.command}\n`);
    process.stdout.write(`${resolved.command}\n`);
    return;
  }

  process.stderr.write(`LMD: using Python ${resolved.versionText}${label}: ${resolved.command}\n`);
  const result = spawnSync(resolved.command, [...resolved.args, ...forwarded], {
    stdio: "inherit",
    cwd: REPOSITORY_ROOT,
    windowsHide: true
  });
  process.exit(result.status ?? 1);
}

// Only run when invoked directly, so the exported helpers can be unit-tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
