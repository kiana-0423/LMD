#!/usr/bin/env node
/**
 * Fails when a message key does not exist in all three languages.
 *
 * The provider falls back to English for a key a locale is missing, so a gap does not crash
 * anything — it produces an interface that is in Japanese except for the six labels nobody
 * translated. That is worse than an obvious failure, because it looks like a decision.
 *
 * TypeScript already enforces this: the locale modules are typed `Record<MessageKey, string>`, so a
 * missing key is a compile error. This runs the same check as a standalone gate, because
 * `npm run typecheck` is a large hammer and a translator adding a key wants to know in a second.
 *
 * It also catches two things the type cannot: a key present but left as the English string, and a
 * key that exists in a translation and not in English.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = join(ROOT, "src/i18n/locales");

/**
 * Reads a locale module's keys and values without executing it.
 *
 * The files are plain object literals with string values, so this parses the shape it knows rather
 * than importing TypeScript into Node.
 */
function readCatalogue(file) {
  const source = readFileSync(join(LOCALES, file), "utf8");
  const entries = new Map();
  // `"key":` or `key:` followed by one or more adjacent string literals (Prettier splits long
  // values across lines, and TypeScript concatenates adjacent literals in the source).
  const pattern = /^\s{2}(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*((?:\s*"(?:[^"\\]|\\.)*"\s*\+?)+)\s*,?\s*$/gm;
  for (const match of source.matchAll(pattern)) {
    const key = match[1] !== undefined ? match[1].replace(/\\"/g, '"') : match[2];
    const value = [...match[3].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((part) => part[1])
      .join("");
    entries.set(key, value);
  }
  return entries;
}

const english = readCatalogue("en-US.ts");
const translations = {
  "zh-CN": readCatalogue("zh-CN.ts"),
  "ja-JP": readCatalogue("ja-JP.ts")
};

const problems = [];

if (english.size < 500) {
  problems.push(`only ${english.size} English keys were parsed; the catalogue format may have changed`);
}

for (const [language, catalogue] of Object.entries(translations)) {
  const missing = [...english.keys()].filter((key) => !catalogue.has(key));
  if (missing.length) {
    problems.push(`${language} is missing ${missing.length} key(s): ${missing.slice(0, 8).join(", ")}`);
  }
  const extra = [...catalogue.keys()].filter((key) => !english.has(key));
  if (extra.length) {
    problems.push(`${language} has ${extra.length} key(s) English does not: ${extra.slice(0, 8).join(", ")}`);
  }
  if (catalogue.size !== english.size) {
    problems.push(`${language} has ${catalogue.size} keys, English has ${english.size}`);
  }
}

/**
 * Keys whose value is legitimately identical in every language.
 *
 * A product name, a language's own endonym, an identifier. Everything else being byte-identical to
 * English means the key was copied and not translated.
 */
const IDENTICAL_ALLOWED = new Set([
  "app.nameChinese",
  "language.ja-JP",
  "language.zh-CN",
  "language.en-US",
  // Two product names. Neither is translated in Chinese or Japanese chemistry writing.
  "label.rdkitMordred",
  // A standard identifier, written the same way in every language.
  "ui.inchiKeyLabel"
]);

for (const [language, catalogue] of Object.entries(translations)) {
  const untranslated = [...english.entries()]
    .filter(([key, value]) => {
      if (IDENTICAL_ALLOWED.has(key)) return false;
      const translated = catalogue.get(key);
      if (translated === undefined) return false;
      // Short values that are pure symbols, units or numbers are the same everywhere.
      if (!/[A-Za-z]{3}/.test(value)) return false;
      return translated === value;
    })
    .map(([key]) => key);
  if (untranslated.length) {
    problems.push(
      `${language} leaves ${untranslated.length} key(s) as the English text: ` +
        `${untranslated.slice(0, 8).join(", ")}`
    );
  }
}

if (problems.length) {
  process.stderr.write("Translation coverage problems:\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write("\nAdd the key to all three files with scripts/add_message_keys.py.\n");
  process.exit(1);
}

process.stdout.write(
  `ok   ${english.size} keys present and translated in ${Object.keys(translations).length + 1} languages\n`
);
