#!/usr/bin/env node
/**
 * Fails when the repository states more than one Node version requirement.
 *
 * The versions live in five places: `package.json` engines, `.nvmrc`, `.node-version`, the CI
 * workflow, and the README. A repository whose README says 22 while its dependencies demand 24 is
 * one where `npm install` prints a warning everybody learns to ignore — until a build fails on a
 * machine that took the README at its word.
 *
 * It also checks the installed dependencies: a package that declares a newer Node than this
 * repository targets is a contradiction, and the fix is to pin the package or raise the target,
 * not to ignore the warning.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The single Node major this repository supports, and the minimum within it. */
const SUPPORTED_MAJOR = 22;
const MINIMUM = "22.12.0";

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

/** The lowest Node version an `engines.node` range admits, as a major number. */
function lowestMajor(range) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(range) ?? /(\d+)/.exec(range);
  return match ? Number(match[1]) : undefined;
}

/** Every installed package that declares an `engines.node`, with the major it demands. */
function dependencyRequirements() {
  const modules = join(ROOT, "node_modules");
  if (!existsSync(modules)) return [];
  const results = [];
  const inspect = (directory, name) => {
    const manifest = join(directory, "package.json");
    if (!existsSync(manifest)) return;
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      const declared = parsed.engines?.node;
      if (declared) results.push({ name, declared });
    } catch {
      // A package with an unreadable manifest is npm's problem, not this check's.
    }
  };
  // Direct dependencies only. A transitive package's engines field is advisory and npm does not
  // enforce it; a direct one is a choice this repository made.
  const direct = Object.keys({
    ...JSON.parse(read("package.json")).dependencies,
    ...JSON.parse(read("package.json")).devDependencies
  });
  for (const name of direct) {
    if (name.startsWith("@")) {
      const [scope, rest] = name.split("/");
      inspect(join(modules, scope, rest), name);
    } else {
      inspect(join(modules, name), name);
    }
  }
  return results;
}

const problems = [];

const manifest = JSON.parse(read("package.json"));
if (!manifest.engines?.node) {
  problems.push("package.json declares no engines.node");
} else if (lowestMajor(manifest.engines.node) !== SUPPORTED_MAJOR) {
  problems.push(`package.json engines.node is "${manifest.engines.node}", expected Node ${SUPPORTED_MAJOR}`);
}
if (!manifest.packageManager) {
  problems.push("package.json declares no packageManager");
}

for (const file of [".nvmrc", ".node-version"]) {
  const value = read(file).trim();
  if (value !== MINIMUM) {
    problems.push(`${file} says "${value}", expected "${MINIMUM}"`);
  }
}

const workflow = read(".github/workflows/build-desktop.yml");
for (const match of workflow.matchAll(/node-version:\s*["']?([\d.]+)["']?/g)) {
  if (lowestMajor(match[1]) !== SUPPORTED_MAJOR) {
    problems.push(`the CI workflow uses node-version ${match[1]}, expected ${SUPPORTED_MAJOR}`);
  }
}

const readme = read("README.md");
if (!readme.includes(`Node.js \`${MINIMUM}`)) {
  problems.push(`README.md does not state Node.js \`${MINIMUM}\` as the supported version`);
}

for (const { name, declared } of dependencyRequirements()) {
  const required = lowestMajor(declared);
  if (required !== undefined && required > SUPPORTED_MAJOR) {
    problems.push(
      `${name} declares engines.node "${declared}", which is newer than the Node ${SUPPORTED_MAJOR} ` +
        "this repository targets. Pin the package to a version that supports it, or raise the target."
    );
  }
}

if (problems.length) {
  process.stderr.write("Node requirements disagree:\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

process.stdout.write(`ok   Node ${MINIMUM}+ declared consistently\n`);
