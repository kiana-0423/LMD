#!/usr/bin/env node
/**
 * Finds user-visible strings in production code that are not translation keys.
 *
 * A string typed into a component renders in English whatever language the user chose, and it is
 * invisible in a screenshot taken by an English-speaking reviewer. This walks the TypeScript AST
 * rather than matching text, so it sees the shapes a regex kept missing: a `||` fallback, a state
 * initializer, a thrown error, a custom prop, JSX that mixes text with expressions, and a string
 * handed to a helper that renders it.
 *
 * What it deliberately does not flag:
 *
 *   - database and file values (molecule names, paths, SMILES, model names): content, not
 *     interface text, and translating them would corrupt what the user stored;
 *   - technical identifiers used as option *values*, element symbols, and unit strings;
 *   - anything in tests, demo modules, or the translation catalogues themselves;
 *   - a literal carrying an `i18n-exempt` comment, which records why.
 *
 * Usage: node scripts/audit-untranslated.mjs [--root DIR] [--json] [path...]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const DEFAULT_ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const SCAN_ROOTS = ["src/features", "src/components", "src/layouts", "src/routes", "src/lib"];

/** Files whose literals are data or infrastructure rather than interface text. */
const EXEMPT_FILES = new Set([
  "src/i18n/LanguageContext.tsx",
  "src/i18n/interpolate.ts",
  "src/i18n/catalogues.ts",
  "src/i18n/businessTranslations.ts",
  "src/i18n/DocumentTranslationBridge.tsx"
]);

/**
 * Directories whose literals are data rather than interface text.
 *
 * `src/lib/demo/` holds the browser demo's sample records, and `src/i18n/locales/` *is* the
 * catalogue — a rule that every user-visible string must go through `t(...)` cannot sensibly be
 * applied to the file those strings live in.
 */
const EXEMPT_PREFIXES = ["src/lib/demo/", "src/i18n/locales/"];

/** True when a file's literals are data rather than interface text. */
function isExempt(relativePath) {
  return (
    EXEMPT_FILES.has(relativePath) ||
    EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  );
}

/** JSX attributes and object properties whose string value is rendered. */
const VISIBLE_NAMES = new Set([
  "title",
  "label",
  "description",
  "placeholder",
  "message",
  "content",
  "okText",
  "cancelText",
  "extra",
  "alt",
  "tooltip",
  "emptyText",
  "notFoundContent",
  "checkedChildren",
  "unCheckedChildren",
  "addonBefore",
  "addonAfter",
  "aria-label",
  "ariaLabel",
  "aria-description",
  "helpText",
  "hint",
  "successText",
  "errorText",
  "warningText",
  "confirmText",
  "heading",
  "subtitle",
  "caption"
]);

/** Calls whose string arguments are shown to the user. */
const VISIBLE_CALLS = [
  /^message\.(success|error|warning|info|loading)$/,
  /^notification\.(success|error|warning|info|open)$/,
  /^Modal\.(confirm|info|success|error|warning)$/,
  /^window\.(alert|confirm|prompt)$/,
  // A helper that reports, describes, notifies or warns is rendering what it is given.
  /(^|\.)(report|describe|notify|toast|announce)[A-Z]\w*$/
];

/** A setter or initializer whose value ends up on screen. */
const VISIBLE_STATE = /^(set)?[a-z]*(error|status|message|text|title|label|hint|warning|notice|caption|summary)$/i;

/** Values that are identifiers, units, or symbols rather than sentences. */
const TECHNICAL =
  /^(?:[A-Z]{1,4}\d*|[a-z]+(?:[-_.][a-z0-9]+)*|wt%|ppm|mass fraction|g\/kg|\d[\w./%-]*|[A-Za-z]+\/[A-Za-z]+|RDKit|Mordred|SMILES|InChI|InChIKey|CSV|SQLite|LMD|MAE|RMSE|R²|SRV|PDSC|PAO)$/;

/** A CSS declaration or a list of class names: every token is lowercase, numeric, or a length. */
const CSS_OR_CLASS =
  /^(?:[a-z][a-z0-9-]*|\d+(?:\.\d+)?(?:px|em|rem|%|s|ms)?)(?: (?:[a-z][a-z0-9-]*|\d+(?:\.\d+)?(?:px|em|rem|%|s|ms)?))*$/;

/** Punctuation that only appears in code, not in a sentence a user reads. */
const CODE_LIKE = /[;{}<>]/;

const EXEMPT_MARKER = "i18n-exempt";

function isInterfaceText(raw) {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 2) return false;
  if (TECHNICAL.test(text) || CSS_OR_CLASS.test(text) || CODE_LIKE.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  // A sentence, or a capitalised label: "Name / Type", "Delete", "Numeric Only".
  return text.includes(" ") || /^[A-Z]/.test(text);
}

/** True when the literal, or the line above it, carries an `i18n-exempt` comment. */
function exempted(source, node) {
  const text = source.getFullText();
  const start = node.getFullStart();
  const leading = text.slice(start, node.getStart(source));
  if (leading.includes(EXEMPT_MARKER)) return true;
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  const lines = text.split("\n");
  return (lines[line] ?? "").includes(EXEMPT_MARKER) || (lines[line - 1] ?? "").includes(EXEMPT_MARKER);
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${callName(expression.expression)}.${expression.name.text}`;
  }
  return "";
}

/** The prose in a template literal, with its interpolations removed. */
function templateProse(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
}

function scan(filePath, root) {
  const text = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const relative = path.relative(root, filePath).split(path.sep).join("/");
  const findings = [];

  const report = (node, kind, value, context = "") => {
    if (!isInterfaceText(value) || exempted(source, node)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      file: relative,
      line: line + 1,
      kind,
      context,
      text: value.replace(/\s+/g, " ").trim()
    });
  };

  /** Reports a node that is a string literal or a template with prose. */
  const reportValue = (node, kind, context) => {
    if (!node) return;
    if (ts.isStringLiteral(node)) report(node, kind, node.text, context);
    else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      report(node, kind, templateProse(node), context);
    }
  };

  /**
   * Reports every literal inside an argument, however deeply it is wrapped.
   *
   * `message.error(shout("Text"))` and `message.error(join(["Text"]))` both put "Text" on screen;
   * only looking at the argument itself would see a call and stop. Translation-key lookups are
   * filtered out by the technical-identifier rule, so `t("ui.thing")` does not register.
   */
  const reportNested = (node, kind, context) => {
    if (!node) return;
    reportValue(node, kind, context);
    ts.forEachChild(node, (child) => reportNested(child, kind, context));
  };

  const visit = (node) => {
    // <Foo title="Text" /> and <Foo ariaLabel="Text" />
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (VISIBLE_NAMES.has(name)) {
        if (ts.isStringLiteral(node.initializer)) {
          report(node.initializer, "jsx-attribute", node.initializer.text, name);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          reportValue(node.initializer.expression, "jsx-attribute", name);
        }
      }
    }

    // Bare text between tags, including text that sits beside an expression.
    if (ts.isJsxText(node)) report(node, "jsx-text", node.text);

    // { title: "Text" } in a column, option, or step definition.
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (VISIBLE_NAMES.has(name)) reportValue(node.initializer, "property", name);
    }

    // message.error("Text"), Modal.confirm({...}), reportSomething("Text")
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (VISIBLE_CALLS.some((pattern) => pattern.test(name))) {
        for (const argument of node.arguments) reportNested(argument, "call", name);
      }
      // useState("Text") and setErrorText("Text")
      if (VISIBLE_STATE.test(name) || name === "useState") {
        for (const argument of node.arguments) reportValue(argument, "state", name);
      }
    }

    // throw new Error("Text")
    if (ts.isNewExpression(node) && callName(node.expression).endsWith("Error")) {
      for (const argument of node.arguments ?? []) reportValue(argument, "throw", "Error");
    }

    // value || "Fallback" and value ?? "Fallback"
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      reportValue(node.right, "fallback", node.operatorToken.getText(source));
    }

    // condition ? "Yes" : "No"
    if (ts.isConditionalExpression(node)) {
      reportValue(node.whenTrue, "choice", "?");
      reportValue(node.whenFalse, "choice", ":");
    }

    // function describe(status, fallback = "Not recorded yet")
    //
    // A default is the value every caller that omits the argument gets, which usually means most
    // of them. It is the string most users actually see, and it is the one furthest from any
    // call site a reviewer would look at.
    if (ts.isParameter(node) && node.initializer) {
      reportValue(node.initializer, "default", node.name.getText(source));
    }

    // return "Waiting in the queue"
    //
    // Whatever renders the call renders this. Looking only at the call site sees an identifier
    // and stops, which is why a string can sit two lines inside a helper and never be noticed.
    if (ts.isReturnStatement(node) && node.expression) {
      reportValue(node.expression, "return", "return");
    }

    // const summarise = () => "Nothing to summarise"
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      reportValue(node.body, "return", "=>");
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  findings.sort((left, right) => left.line - right.line || left.text.localeCompare(right.text));
  return findings;
}

function collect(targets, root) {
  const findings = [];
  for (const target of targets) {
    const base = path.join(root, target);
    if (!fs.existsSync(base)) continue;
    const files = fs.statSync(base).isFile() ? [base] : walk(base);
    for (const file of files) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (isExempt(relative) || relative.includes("__tests__")) continue;
      findings.push(...scan(file, root));
    }
  }
  return findings;
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

function main(argv) {
  const asJson = argv.includes("--json");
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? DEFAULT_ROOT : path.resolve(argv[rootIndex + 1]);
  const positional = argv.filter(
    (value, index) => !value.startsWith("--") && argv[index - 1] !== "--root" && index >= 2
  );
  const findings = collect(positional.length ? positional : SCAN_ROOTS, root);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
    return findings.length ? 1 : 0;
  }
  if (findings.length === 0) {
    process.stdout.write("ok   no hard-coded user-visible strings\n");
    return 0;
  }
  process.stderr.write(`FAIL ${findings.length} hard-coded user-visible string(s):\n`);
  for (const finding of findings) {
    const context = finding.context ? ` ${finding.context}` : "";
    process.stderr.write(
      `  ${finding.file}:${finding.line}: ${finding.kind}${context} — ${JSON.stringify(finding.text)}\n`
    );
  }
  process.stderr.write(
    "\nRoute these through `t(...)` and add the key to src/i18n/locales/ in all three " +
      'languages. Database and file values are content, not interface text: mark them with translate="no" ' +
      "and keep them out of the catalogue. A literal that is genuinely data may carry an " +
      "`i18n-exempt` comment saying why.\n"
  );
  return 1;
}

process.exit(main(process.argv));
