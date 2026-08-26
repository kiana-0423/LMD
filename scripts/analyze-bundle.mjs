#!/usr/bin/env node
/**
 * Measures the built frontend and fails when it regresses.
 *
 * "The bundle got bigger" is not something anyone notices by reading a build log: the numbers scroll
 * past, they are all plausible, and the one that matters — how much JavaScript the browser must
 * download and parse before it can draw anything — is not printed at all. Vite lists chunks, not
 * the initial graph.
 *
 * So this walks the manifest from the entry, follows only the *static* imports (a dynamic import is
 * a route the user has not visited), and reports that total. Route chunks, the Ketcher editor, and
 * the Indigo worker and WebAssembly module are reported separately, because they are loaded on
 * demand and their size is a different question.
 *
 * It also fails on things no size number would reveal: a mock dataset that reached a desktop build,
 * or Ketcher compiled into two chunks at once.
 *
 * Usage:
 *   node scripts/analyze-bundle.mjs                 analyse dist/ and enforce the budgets
 *   node scripts/analyze-bundle.mjs --dir dist-demo analyse another build
 *   node scripts/analyze-bundle.mjs --json          machine-readable output
 *   node scripts/analyze-bundle.mjs --allow-demo    skip the mock-marker check (for a demo build)
 */

import { gzipSync } from "node:zlib";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The budgets.
 *
 * `initialJs` is the one that governs how the application feels when it opens. The others exist to
 * catch a specific regression rather than to police a number: `ketcherChunk` fails if the Base64
 * Indigo entry comes back (it is 16 MB of JavaScript), and `indigoWasm` fails if the render-capable
 * Indigo build is substituted for the `-norender` one LMD uses.
 */
const BUDGETS = {
  initialJsGzip: 260 * 1024,
  initialJsRaw: 800 * 1024,
  /** Any route other than the sketcher. The sketcher carries a third-party editor; see below. */
  routeGzip: 250 * 1024,
  /**
   * The whole molecule editor: Ketcher's React application, its bundled structure-template
   * library, Miew's 3D renderer, and the Indigo worker.
   *
   * Generous, because this is Ketcher's size rather than LMD's, and it is read from disk rather
   * than downloaded. Tight enough to fail loudly if the Base64 Indigo entry returns: that entry is
   * a single 16 MB JavaScript file, which would blow through this by a wide margin.
   */
  sketcherRouteGzip: 2_100 * 1024,
  indigoWasm: 6 * 1024 * 1024,
  indigoWorkerGzip: 60 * 1024
};

/** Strings that only ever appear in the browser-demo modules. */
const MOCK_MARKERS = [
  "buildMock3dMolBlock",
  "buildMockPdbBlock",
  "buildMockSdfBlock",
  "LMD GENERATED 3D",
  "mockListMolecules",
  "mockGetDashboardSummary",
  "dispatchDemoCommand"
];

function parseArguments(argv) {
  const options = { dir: "dist", json: false, allowDemo: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dir") options.dir = argv[(index += 1)];
    else if (argv[index] === "--json") options.json = true;
    else if (argv[index] === "--allow-demo") options.allowDemo = true;
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const DIST = resolve(ROOT, options.dir);

if (!existsSync(DIST)) {
  process.stderr.write(`No build at ${DIST}. Run \`npm run build\` first.\n`);
  process.exit(1);
}

const manifestPath = [join(DIST, ".vite/manifest.json"), join(DIST, "manifest.json")].find(existsSync);
if (!manifestPath) {
  process.stderr.write(`No Vite manifest in ${DIST}. Set build.manifest in vite.config.ts.\n`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const sizeCache = new Map();
function sizes(relative) {
  if (sizeCache.has(relative)) return sizeCache.get(relative);
  const path = join(DIST, relative);
  const raw = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  const measured = { raw: raw.length, gzip: raw.length ? gzipSync(raw).length : 0 };
  sizeCache.set(relative, measured);
  return measured;
}

/**
 * Every chunk the browser needs before the first render.
 *
 * `imports` are static and are followed; `dynamicImports` are not, because they are exactly the
 * code that was split out to avoid loading it up front. Conflating the two is how a "code split"
 * that changed nothing gets reported as a win.
 */
function initialGraph() {
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("the manifest declares no entry chunk");
  const seen = new Set();
  const walk = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    for (const imported of manifest[key]?.imports ?? []) walk(imported);
  };
  const entryKey = Object.keys(manifest).find((key) => manifest[key] === entry);
  walk(entryKey);
  return [...seen].map((key) => manifest[key]).filter(Boolean);
}

const initial = initialGraph();
const initialFiles = new Set(initial.map((chunk) => chunk.file));
const initialTotals = initial.reduce(
  (total, chunk) => {
    const measured = sizes(chunk.file);
    return { raw: total.raw + measured.raw, gzip: total.gzip + measured.gzip };
  },
  { raw: 0, gzip: 0 }
);

/**
 * What each lazily-loaded route actually costs.
 *
 * A flat list of chunk names cannot answer "how much does opening the sketcher download?", because
 * a route pulls in its own chunk plus everything that chunk imports. Grouping by route makes the
 * answer readable — and makes it obvious when a heavy dependency belongs to one screen rather than
 * to the application.
 */
function closure(startKey, exclude, { followDynamic = false } = {}) {
  const seen = new Set();
  const walk = (key) => {
    if (!key || seen.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) return;
    if (exclude.has(chunk.file)) return;
    seen.add(key);
    for (const imported of chunk.imports ?? []) walk(imported);
    if (followDynamic) for (const imported of chunk.dynamicImports ?? []) walk(imported);
  };
  walk(startKey);
  return [...seen].map((key) => manifest[key]);
}

/** The route modules, found by their source path rather than by their hashed output name. */
const routeEntries = Object.entries(manifest)
  .filter(([key]) => /^src\/features\/.*Page\.tsx$/.test(key))
  .map(([key, chunk]) => ({ key, name: basename(key, ".tsx"), file: chunk.file }));

const routes = routeEntries
  .map((entry) => {
    // What opening the route downloads: its own chunk and everything it imports statically. A
    // dynamic import inside it — the chart canvas, the Indigo engine — is deferred again, and
    // counting it here would report a split that worked as though it had not.
    const chunks = closure(entry.key, initialFiles);
    const everything = closure(entry.key, initialFiles, { followDynamic: true });
    const sum = (list) =>
      list.reduce(
        (total, chunk) => {
          const measured = sizes(chunk.file);
          return { raw: total.raw + measured.raw, gzip: total.gzip + measured.gzip };
        },
        { raw: 0, gzip: 0 }
      );
    const totals = sum(chunks);
    const complete = sum(everything);
    return {
      ...entry,
      chunkCount: chunks.length,
      files: everything.map((chunk) => chunk.file),
      ...totals,
      deferredGzip: complete.gzip - totals.gzip
    };
  })
  .sort((left, right) => right.gzip - left.gzip);

/** Every chunk that is not part of the initial graph, largest first. */
const routeChunks = Object.values(manifest)
  .filter((chunk) => chunk.file?.endsWith(".js") && !initialFiles.has(chunk.file))
  .map((chunk) => ({ name: basename(chunk.file), file: chunk.file, ...sizes(chunk.file) }))
  .sort((left, right) => right.gzip - left.gzip);

/** Every emitted file, so assets the manifest does not name are still measured. */
function allFiles(directory = DIST, prefix = "") {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(path).isDirectory()) found.push(...allFiles(path, relative));
    else found.push(relative);
  }
  return found;
}
const emitted = allFiles();

const wasmFiles = emitted.filter((file) => file.endsWith(".wasm"));
const workerFiles = emitted.filter((file) => /indigoworker/i.test(file) && file.endsWith(".js"));
const jsFiles = emitted.filter((file) => file.endsWith(".js"));
const chunkText = new Map(jsFiles.map((file) => [file, readFileSync(join(DIST, file), "utf8")]));

/** The sketcher route, which is where Ketcher and Indigo live. */
const sketcherRoute = routes.find((route) => route.name === "MoleculeSketcherPage");
const sketcherFiles = new Set(sketcherRoute?.files ?? []);

/**
 * Identifiers that appear in exactly one place in Ketcher's source.
 *
 * Counting *chunks that mention Ketcher* is not a duplication test: the React editor, the template
 * library and the Indigo worker are three different things, and finding them in three chunks is the
 * split working. Duplication means the same module compiled twice, so the test is whether one of
 * these identifiers turns up in more than one file. They are distinctive enough that a chunk merely
 * listing `MoleculeSketcherPage.js` as a dependency does not match.
 */
const SENTINELS = [
  "StandaloneStructServiceProvider",
  "KetcherLogger",
  "indigo-ketcher",
  "ACESFilmicToneMapping"
];

const duplicated = SENTINELS.map((sentinel) => ({
  sentinel,
  files: jsFiles.filter((file) => chunkText.get(file).includes(sentinel)).map((file) => basename(file))
})).filter((entry) => entry.files.length > 1);

const problems = [];
const notes = [];

if (initialTotals.gzip > BUDGETS.initialJsGzip) {
  problems.push(
    `initial JavaScript is ${(initialTotals.gzip / 1024).toFixed(0)} kB gzipped, over the ` +
      `${(BUDGETS.initialJsGzip / 1024).toFixed(0)} kB budget`
  );
}
if (initialTotals.raw > BUDGETS.initialJsRaw) {
  problems.push(
    `initial JavaScript is ${(initialTotals.raw / 1024).toFixed(0)} kB raw, over the ` +
      `${(BUDGETS.initialJsRaw / 1024).toFixed(0)} kB budget`
  );
}

// The Indigo engine has to be separate assets. If it is inlined again there will be no .wasm at
// all, and the chunk that swallowed it will be enormous.
if (wasmFiles.length === 0) {
  problems.push(
    "no .wasm asset was emitted: the Indigo engine is inlined again. Import " +
      "`ketcher-standalone/dist/binaryWasmNoRender`, not the package's default entry."
  );
}
for (const file of wasmFiles) {
  const measured = sizes(file);
  if (measured.raw > BUDGETS.indigoWasm) {
    problems.push(
      `${basename(file)} is ${(measured.raw / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${(BUDGETS.indigoWasm / 1024 / 1024).toFixed(1)} MB budget — the render-capable Indigo ` +
        "build may have been substituted for the -norender one"
    );
  }
}
if (workerFiles.length === 0) {
  problems.push("no Indigo worker asset was emitted");
}
for (const file of workerFiles) {
  const measured = sizes(file);
  if (measured.gzip > BUDGETS.indigoWorkerGzip) {
    problems.push(`${basename(file)} is ${(measured.gzip / 1024).toFixed(0)} kB gzipped, over budget`);
  }
}

// A route chunk that is loaded on demand may be large; one that is *unexpectedly* large usually
// means something shared leaked into it.
for (const route of routes) {
  const budget = route.name === "MoleculeSketcherPage" ? BUDGETS.sketcherRouteGzip : BUDGETS.routeGzip;
  if (route.gzip > budget) {
    problems.push(
      `route ${route.name} downloads ${(route.gzip / 1024).toFixed(0)} kB gzipped, over the ` +
        `${(budget / 1024).toFixed(0)} kB budget`
    );
  }
}

// The sketcher's cost must stay on the sketcher. Ketcher reaching the initial graph would mean
// every user pays for an editor most of them never open.
for (const file of initialFiles) {
  const text = chunkText.get(file) ?? "";
  if (SENTINELS.some((sentinel) => text.includes(sentinel))) {
    problems.push(`${basename(file)} is loaded before the first render and contains Ketcher or Indigo`);
  }
}

// Duplication: the same module compiled into two chunks is downloaded and parsed twice.
for (const entry of duplicated) {
  problems.push(
    `${entry.sentinel} appears in ${entry.files.length} chunks (${entry.files.join(", ")}); ` +
      "Ketcher or Indigo has been duplicated"
  );
}

// The one that is not about size at all.
const contaminated = [];
if (!options.allowDemo) {
  for (const file of jsFiles) {
    const text = readFileSync(join(DIST, file), "utf8");
    const hits = MOCK_MARKERS.filter((marker) => text.includes(marker));
    if (hits.length) contaminated.push({ file: basename(file), markers: hits });
  }
  for (const entry of contaminated) {
    problems.push(
      `${entry.file} contains browser-demo markers (${entry.markers.join(", ")}). A desktop build ` +
        "must not carry mock datasets; build the demo separately with VITE_DEMO_MODE=true."
    );
  }
} else {
  notes.push("demo markers were not checked (--allow-demo)");
}

const report = {
  directory: options.dir,
  initial: {
    chunks: initial.map((chunk) => ({ name: basename(chunk.file), ...sizes(chunk.file) })),
    raw: initialTotals.raw,
    gzip: initialTotals.gzip
  },
  routeChunks: routeChunks.slice(0, 12).map(({ name, raw, gzip }) => ({ name, raw, gzip })),
  routes: routes.map(({ name, raw, gzip, chunkCount, deferredGzip }) => ({
    name,
    raw,
    gzip,
    chunkCount,
    deferredGzip
  })),
  ketcher: [...sketcherFiles].map((file) => ({ name: basename(file), ...sizes(file) })).sort(
    (left, right) => right.raw - left.raw
  ),
  duplicated,
  indigo: {
    wasm: wasmFiles.map((file) => ({ name: basename(file), ...sizes(file) })),
    worker: workerFiles.map((file) => ({ name: basename(file), ...sizes(file) }))
  },
  demoMarkers: contaminated,
  budgets: BUDGETS,
  problems,
  notes
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const kb = (value) => `${(value / 1024).toFixed(1)} kB`;
  const line = (label, value) => process.stdout.write(`  ${label.padEnd(46)}${value}\n`);

  process.stdout.write(`\nBundle analysis (${options.dir})\n\n`);
  process.stdout.write("Initial JavaScript (entry + static imports)\n");
  for (const chunk of report.initial.chunks) line(chunk.name, `${kb(chunk.raw)} raw / ${kb(chunk.gzip)} gzip`);
  line("TOTAL", `${kb(report.initial.raw)} raw / ${kb(report.initial.gzip)} gzip`);

  process.stdout.write("\nWhat each route downloads when it is first opened\n");
  for (const route of report.routes) {
    const deferred = route.deferredGzip > 0 ? ` (+${kb(route.deferredGzip)} gzip deferred)` : "";
    line(`${route.name} (${route.chunkCount} chunks)`, `${kb(route.raw)} raw / ${kb(route.gzip)} gzip${deferred}`);
  }

  process.stdout.write("\nLargest on-demand chunks\n");
  for (const chunk of report.routeChunks) line(chunk.name, `${kb(chunk.raw)} raw / ${kb(chunk.gzip)} gzip`);

  process.stdout.write("\nKetcher editor (the sketcher route)\n");
  for (const chunk of report.ketcher) line(chunk.name, `${kb(chunk.raw)} raw / ${kb(chunk.gzip)} gzip`);

  process.stdout.write("\nIndigo engine\n");
  for (const asset of [...report.indigo.wasm, ...report.indigo.worker]) {
    line(asset.name, `${kb(asset.raw)} raw / ${kb(asset.gzip)} gzip`);
  }

  process.stdout.write("\nDuplication\n");
  line("Ketcher / Indigo modules in two chunks", duplicated.length ? `${duplicated.length}` : "none");

  process.stdout.write("\nBrowser-demo markers\n");
  line("mock data in this build", contaminated.length ? `${contaminated.length} file(s)` : "none");
  for (const note of notes) process.stdout.write(`  note: ${note}\n`);
  process.stdout.write("\n");
}

if (problems.length) {
  process.stderr.write("Bundle budget failures:\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write(
    "\nFix the cause. Raising a budget or a chunk-size warning limit does not make the download " +
      "smaller.\n"
  );
  process.exit(1);
}

process.stdout.write("ok   every bundle budget met\n");
