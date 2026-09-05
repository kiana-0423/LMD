# LMD

## Overview

LMD is a local desktop database and intelligent-design application for lubricant-material research. It organizes molecules, descriptors, base oils, additives, formulations, experimental conditions, performance results, analysis, and prediction in one local workflow.

The project is currently an MVP. It provides a working Tauri desktop foundation, local SQLite storage, a Python scientific-computing sidecar, molecule drawing and import workflows, descriptor management, formulation and experimental data pages, and data-mining entry points.

## Technology

- React, TypeScript, Ant Design, and Vite provide the user interface.
- Tauri 2 and Rust provide the desktop shell, SQLite initialization, local file management, database commands, and sidecar integration.
- Python provides SMILES standardization, RDKit and Mordred descriptors, 2D/3D structure generation and format conversion, Excel/CSV preprocessing, and scikit-learn model training and prediction.
- SQLite stores local application data in the workspace database `lmd.sqlite`.

## Import a molecule from MOL2

Open **Data Entry → Molecule Entry → Import MOL2** and select a `.mol2` file
containing one molecule (up to 5 MB). The local RDKit sidecar parses its atom and
bond records and fills canonical SMILES; no embedded SMILES property is required
or trusted. An empty name is filled from the filename. Existing names, categories,
notes and custom data sources are preserved. Review the fields, then use the usual
save-and-calculate-descriptors action; importing alone does not write a record.

Empty, unreadable and multi-molecule files fail without changing the form. Split
multi-molecule files before importing. MOL2 support follows
[RDKit's atom-typing limitations](https://www.rdkit.org/docs/source/rdkit.Chem.rdmolfiles.html#rdkit.Chem.rdmolfiles.MolFromMol2Block);
unsupported atom types are not guessed. Conversion preserves the structure RDKit
can read, but this entry action does not retain the original MOL2 coordinates or
file as an attachment. It requires the desktop sidecar, not the browser demo.

Both import screens use one MOL2 normalization and validation pipeline. It checks
record counts, atom references, duplicate bonds, coordinates and bond types before
RDKit parsing. Comments, blank record lines, sparse/reordered atom IDs, different
line endings and missing final newlines are normalized without changing connectivity.
For Materials Studio exports, `un` bonds are interpreted only in isolated six-member
sp2 carbon/pyridine-like nitrogen rings: carbon needs one explicit external single
bond; nitrogen must have only its two ring neighbours. O.co2 labels are reconciled
with explicit neutral oxygen valence (two single bonds or one double bond); actual
terminal carboxylate pairs retain their original typing and charge interpretation.
Known bond orders are preserved. RDKit must still parse and sanitize the result.
Both screens disclose these interpretations and save original bond IDs and oxygen
type changes in Notes. Unknown bonds outside these supported patterns, incomplete
files and unsupported types require re-export with explicit bonds (MOL/SDF can be
used in Ketcher). This is compatibility handling, not a guarantee for every MOL2
dialect or a reconstruction of missing chemical information.

In **Molecule Sketcher**, use **Import PDB / MOL2** above the Ketcher canvas to
load either format as an editable 2D structure. The formula appears beside the
import button; edits and undo/redo refresh SMILES and formula after a short
pause, and invalidate descriptors computed for the previous structure. Atom,
bond, charge and hydrogen corrections use Ketcher's normal tools. Saving uses
the current canvas and retains import provenance in the molecule's notes.
The canvas remains on one page. Files are limited to 5 MB and 2000 input atoms;
multi-model PDB files must be split before import. PDB connectivity and bond
orders may be incomplete, so the canvas includes a review reminder.

## Requirements

These requirements are for developers and release builders only. People who install a finished LMD package do not need Node.js, Rust, Python, Conda, RDKit, or SQLite.

- Node.js `22.12.0` or newer within the 22 line (`.nvmrc` and `.node-version` both pin `22.12.0`)
- npm `10.5.0` or newer
- Stable Rust and Cargo
- Python `3.10–3.12`
- The exact dependency set in `python-sidecar/requirements.lock` — RDKit, Mordred, networkx,
  NumPy, pandas, SciPy, scikit-learn, joblib, openpyxl, and their pinned transitive packages
- Platform-specific Tauri build prerequisites

One Node version, stated once. `package.json` `engines`, `.nvmrc`, `.node-version`, the CI
workflow and this list are compared by `npm run audit:node-requirements`, which also fails when an
installed dependency declares a newer Node than the repository targets — that is how Ketcher 3.15,
which requires Node 24.14.1, is kept from silently contradicting a Node 22 build. LMD pins
`ketcher-react` and `ketcher-standalone` to `3.14.0`, the newest release in the same major line
that supports Node 22.

The same is true of Python: the supported range is declared in `python-sidecar/pyproject.toml`,
`scripts/build_sidecar.py`, `scripts/resolve-python.mjs` and this file, and
`npm run audit:python-requirements` fails when they disagree.

RDKit is often easier to install from conda-forge than from pip.

## Development Setup

Install frontend dependencies:

```bash
npm install --include=dev
```

Create the Python environment and install the exact dependency set the sidecar is tested with:

```bash
# A project-local virtual environment. The resolver finds this automatically; nothing has to be
# exported and no environment has to stay activated.
python3.11 -m venv python-sidecar/.venv
python-sidecar/.venv/bin/python -m pip install -r python-sidecar/requirements.lock
```

Conda works just as well, and is often easier for RDKit:

```bash
conda create -n lmd python=3.11 -y
conda activate lmd
python -m pip install -r python-sidecar/requirements.lock
```

Start the complete desktop application:

```bash
npm run tauri dev
```

**No `PYTHON` export is needed.** Every script that needs Python goes through
`scripts/resolve-python.mjs`, which searches in this order and *runs* each candidate to read its
real version — a name on `PATH` proves nothing, and `python3` is 3.9 on a stock macOS:

1. `LMD_PYTHON` — an explicit choice for this project
2. `PYTHON` — the conventional override
3. `CONDA_PREFIX` — the environment that is already active
4. `VIRTUAL_ENV`, then `.venv` or `python-sidecar/.venv`
5. `py -3.12` / `py -3.11` / `py -3.10` on Windows
6. `python3.12`, `python3.11`, `python3.10`
7. `python3`, then `python` — accepted only if the version is supported

It prints the interpreter it chose, and when none is usable it says what to install rather than
failing with "command not found". Check it directly with:

```bash
npm run python
```

`tauri dev` installs the development sidecar launcher automatically. Running the Rust toolchain
directly does not, so install it once before `cargo test`, `cargo clippy`, or `cargo build`:

```bash
npm run sidecar:prepare-dev
```

Preparation also runs the launcher's real health check before Vite starts. Missing scientific
dependencies or a broken Python environment stop startup with an error in the terminal. Install
`python-sidecar/requirements.lock` into the selected environment and retry. The launcher checks
both `.venv` and `python-sidecar/.venv`, in that order, after explicit/active environment overrides.

Preparation refreshes the sidecar resource timestamp so Cargo replaces an older packaged sidecar
in `target/debug` when returning to development. If an existing development app still reports an
unavailable sidecar, stop it and restart with `npm run tauri dev` to rebuild and refresh its status.

Without it the Tauri build script fails with `resource path binaries/lmd-sidecar-<triple> doesn't
exist`, because the packaged sidecar is never committed to the repository.

Start only the browser UI:

```bash
npm run dev
```

Browser mode uses mock fallbacks and does not provide complete Tauri, SQLite, or sidecar behavior.

## Standalone Desktop Installers

```bash
# Build on Apple Silicon macOS
conda activate lmd-build
cd python-sidecar
python -m pip install -r requirements.lock
cd ..
npm run desktop:build:mac
```

This first packages Python, RDKit, Mordred, networkx, pandas, openpyxl, SciPy, scikit-learn and joblib into a native sidecar, then runs that executable through every production command — health, descriptors, batch descriptors, 3D generation, format conversion, CSV and XLSX import/export, and a full train/predict/describe cycle across three separate processes — before creating the Tauri app and DMG. The DMG is written under `src-tauri/target/release/bundle/dmg/`.

Windows packages must be built on Windows because PyInstaller and Tauri package native binaries. On a Windows x64 build machine, install Node.js 22, stable Rust, Python 3.11, and the Tauri Windows prerequisites, then run:

```powershell
cd python-sidecar
python -m pip install -r requirements.lock
cd ..
npm ci
npm run desktop:build:windows
```

The NSIS EXE and MSI are written under `src-tauri\target\release\bundle\nsis\` and `src-tauri\target\release\bundle\msi\`. The Windows configuration uses Tauri's offline WebView2 installer, so installing and launching LMD does not require an internet connection. This increases the installer size.

### Build Windows without a Local Windows PC

The workflow at `.github/workflows/build-desktop.yml` builds both targets on native GitHub-hosted runners:

1. Push the repository to GitHub.
2. Open **Actions → Build desktop installers → Run workflow**.
3. Download `LMD-macOS-Apple-Silicon` or `LMD-Windows-x64` from the completed workflow's artifacts.

The workflow also runs automatically for tags such as `v0.1.0`.

### Before Public Distribution

CI output without certificates is suitable for internal testing, but public releases should be signed. macOS distribution requires an Apple Developer certificate and notarization; Windows should use an Authenticode code-signing certificate to reduce SmartScreen warnings. Validate each signed installer on a clean machine that has no developer tools installed.

## Project Structure

- `src/`: React application, features, API wrappers, and localization
  - `src/i18n/locales/`: one module per language; English is bundled, the other two are chunks
  - `src/lib/demo/`: the browser demo's sample records, reachable only in a `VITE_DEMO_MODE` build
- `src-tauri/`: Rust backend, SQLite schema, Tauri commands, paths, and bundle configuration
- `python-sidecar/`: Python CLI and scientific-computing services
- `public/`: frontend static assets
- `asset/`: source design assets

Generated directories such as `dist/`, `node_modules/`, `src-tauri/target/`, Python environments, and caches should not be committed as source.

Old build output can be removed from `dist/`, `dist-demo/`, `src-tauri/target/`,
`python-sidecar/build/`, and `python-sidecar/dist/`. Keep `node_modules/` and
`python-sidecar/.venv/` for development; the next build recreates its output directories.

## Main Features

- Dashboard with live SQLite workspace statistics
- Molecule Library with 2D/3D views and descriptor summaries
- Molecule Entry and Ketcher-based Molecule Sketcher
- RDKit and Mordred Descriptor Center
- Base Oils / Additives library
- Formulation Library and Formulation Entry
- Experiments & Performance entry
- Analysis: distributions, additive/base-oil/formulation comparisons, concentration trends, and
  descriptor-performance correlation (Pearson and Spearman)
- Molecule-performance prediction from a locally trained scikit-learn model
- Molecule Screening: ranks existing library molecules with a trained model
- Molecular Design: generates candidates using an optional phosphate-ester template or seed-fragment exchange,
  keeps them in a candidate collection apart from the library, and assesses each performance
  prediction by the evidence behind it (see below)
- Formulation prediction from a locally trained scikit-learn model
- Two-stage Import / Export: preview a file, review the detected type, columns, warnings and row
  counts, then confirm — the database is not touched until you do
- Settings with workspace path, database path, schema version, integrity check, verified backups,
  restore, and an exportable diagnostics report
- English, Simplified Chinese, and Japanese settings, with English as the default

## Architecture Notes

React calls Rust through Tauri commands. Rust owns all SQLite writes and invokes the Python sidecar through a JSON CLI protocol. The sidecar does not write directly to SQLite.

Structure files, exports, attachments, reports, and models should be stored under the workspace directory. The database should store relative paths.

Production mode uses real descriptor calculations and does not substitute mock results for
unavailable scientific dependencies. There is no `allow_mock` switch and no code path that can
produce a placeholder descriptor: a missing RDKit or Mordred raises an actionable error, and the
Rust persistence layer refuses to store any descriptor record whose mode is not `real`.

Every database connection is opened through `db::open_database`, which enables foreign keys and
WAL and sets a busy timeout. Schema changes are versioned with `PRAGMA user_version` and applied
in order by `db::migrations::apply_migrations`.

Every list pages in SQL rather than loading a table into the browser, and every aggregate is a
join rather than a query per row. `list_base_oils_page`, `list_additives_page`,
`list_formulations_page`, `list_experiments_page` and `list_performance_results_page` take a
bounded page request and return the total the database counted; the selectors use
`search_base_oils`, `search_additives` and `search_formulations`, which return an id, a label and a
short qualifier rather than whole records. Ordering is always `created_at DESC, id DESC`, because
`created_at` alone is not a total order — two records written in the same second would tie, and a
row could appear on two pages while another was never shown.

Descriptor values are only sent to the frontend when a caller explicitly asks for them, and the
Descriptor Centre reads the status of a whole page in one query rather than one call per molecule.

Writing an experiment and its performance result is a single transaction
(`save_experiment_with_performance`): both rows are written, or neither. Deleting a base oil or an
additive that formulations still reference is refused, and the refusal names the formulations;
removing them anyway is a separate command that requires an explicit acknowledgement and reports
every component it removed.

CSV exports are generated in Rust from SQLite and written to the workspace `exports/` directory;
the browser build falls back to a download of demo content. Exported fields are quoted and
formula-prefixed values are escaped so a spreadsheet cannot execute them.

Analysis and model training read stored records only. Descriptor records whose `mode` is not
`real` are excluded from correlations, training, and prediction, and the sidecar no longer has any
code path that can produce a placeholder descriptor: a missing RDKit or Mordred is an error.

Models are trained by the packaged sidecar with scikit-learn, saved under `files/models/` in the
active workspace, and recorded in the `models` table together with the feature order, metrics,
algorithm, sample count, dataset mode, dataset scope, independent molecule count, condition
coverage, and validation split method — so a model's provenance is readable after a restart, not
only in the response of the call that created it. The fitted bundle also records the training
feature ranges and the training molecules, which is what lets a later design assessment place a
candidate against the data the model saw.

Generated structures live in `design_candidates`, with their real descriptors in
`design_candidate_descriptors` and every assessment in `design_predictions`. None of the three is
read by the training dataset builder, and a candidate reaches `molecules` only through
`promote_design_candidate`.

Long-running work writes a row to the `jobs` table before it starts and closes it on every exit
path. A job that ends without reporting an outcome is marked `failed`, so nothing is left claiming
to be `running`. Descriptor batch history is shown in the Descriptor Center. Prediction loads that bundle back and refuses any molecule that is
missing a feature the model was trained on. When a workspace has too few records, training returns
an error stating how many are required and how many exist — it never fabricates a result.

There are exactly three runtime states, and they are mutually exclusive:

- **Desktop** — inside Tauri. Every call is a real command; demo data is not in the bundle at all.
- **Explicit demo** — outside Tauri, built with `VITE_DEMO_MODE=true` (`npm run build:demo`). Calls
  are answered by `src/lib/demo/adapter.ts`, loaded on demand, and the sidebar shows a badge.
- **Anything else** — outside Tauri without the flag. Every data call fails with
  `[app.desktopOnly]`. This is the important one: a clear refusal is honest, invented data is not.

`npm run analyze:bundle` fails the build if any mock marker appears in a desktop bundle.

The molecule editor loads Indigo as separate Worker and WebAssembly assets
(`ketcher-standalone/dist/binaryWasmNoRender`) rather than the default entry, which inlines the
whole engine as Base64 inside a 16 MB JavaScript file. Both assets ship inside the installer and
are read over the Tauri custom protocol; nothing reaches the network. The `-norender` Indigo build
is used because LMD never asks Indigo to render an image — Ketcher draws in the browser and every
conversion goes through Ketcher itself or the RDKit sidecar.

## Checks

Continuous integration runs these on every push and pull request, and `build` only runs after they
pass. To run them locally:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run audit                    # placeholders, strings, Node/Python consistency, command surface
npm run build
npm run analyze:bundle           # bundle budgets, and mock markers in the desktop build
npm ls --depth=0

npm run sidecar:prepare-dev      # required before the Rust steps
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test

npm run sidecar:check-lock       # the active environment against requirements.lock
npm run sidecar:test             # pytest, through the resolved interpreter
```

`npm run audit` runs, in order: unresolved production placeholders, hard-coded user-visible
strings, the Python version range declared consistently across four files, the Node version
declared consistently across five, the Tauri command surface (nothing registered that is unused,
nothing invoked that is unregistered), and the audits' own tests.

## Current Limitations

- **Clean-machine installer validation is outstanding.** The checks in
  `docs/installer-smoke-tests.md` must be run on real macOS and Windows machines that have no
  Node.js, Rust, Python, or Conda. A successful build is not evidence that an installed package
  runs.
- **CI artifacts are unsigned unless signing secrets are configured.** When they are, the workflow
  imports the certificate, signs, and verifies the result with `codesign --verify` or
  `Get-AuthenticodeSignature`, failing the job if verification fails; it reports the signing state
  of every artifact in the job summary. Gatekeeper, notarization stapling, SmartScreen reputation,
  and MSI uninstall/reinstall are **not** verified by CI and remain outstanding — see
  `docs/installer-smoke-tests.md`.
- **The `'wasm-unsafe-eval'` CSP directive has not been runtime-verified.** It replaced the much
  broader `'unsafe-eval'` on static evidence: `ketcher-standalone`'s indigo worker calls
  `WebAssembly.instantiate`, and the production bundle contains no `eval(` or `new Function(`.
  Step 7 of the macOS smoke test confirms it against the packaged app, and records the rollback.
- **Every string LMD renders comes from the key catalogue, including the ones the backend
  produces.** `src/i18n/LanguageContext.tsx` holds the English, Simplified Chinese, and Japanese
  text for every page, drawer, modal, table column, empty state, validation message, and toast.
  `scripts/audit-untranslated.mjs` walks the TypeScript AST and fails the build if a new literal
  appears — in a JSX attribute or text node, an object property, a `||` or `??` fallback, a
  ternary, a state initializer or setter, a thrown `Error`, a template literal, a custom prop such
  as `ariaLabel`, a default parameter value, a `return`, or a string handed to a helper that
  renders it. It reads `.ts` as well as `.tsx`. A test asserts every key resolves in all three
  languages. The DOM translation bridge survives for one purpose only: Ketcher's own chrome, which
  a third-party bundle renders outside React and which therefore cannot be given keys. It runs
  inside `[data-i18n-ketcher]` and nowhere else.
- **Backend prose is a message descriptor, not a sentence.** Rust and the Python sidecar send a
  `code` naming the situation, the `params` the sentence needs, and an untranslated `detail`
  carrying the specifics. `src/lib/backendMessages.ts` assembles the sentence in the current
  language. This covers performance metric names, analysis method and missing-value descriptions,
  insufficient-data messages, dataset interpretations, training and exclusion warnings, validation
  split descriptions, skipped-prediction reasons, and job status summaries. Tokens such as
  `baseOils` and `wt%` are translated; molecule names, units, paths and SMILES arrive as parameters
  and are substituted unchanged. `src/__tests__/backend-message-contract.test.ts` reads the Rust and
  Python sources and fails when a code exists on one side and not the other, or renders with an
  unfilled placeholder in any language; `src/__tests__/backend-language.test.tsx` renders non-empty
  backend results in Chinese and Japanese and asserts the English never reaches the screen.
- **Backend errors carry a stable code and an English detail.** A command returns, for example,
  `[model.basisMismatch] 'Blend 3' records concentrations as 'wt%'…`. The frontend translates the
  code into the user's language and shows the detail — an id, a unit, a path, a SQLite message —
  exactly as it arrived, because that is what makes the error actionable. An error whose code this
  build does not recognise is shown in full rather than replaced by a tidier sentence, and the
  bracketed code itself is never rendered.
- **A model records one concentration basis, and a prediction must match it exactly.** A training
  dataset may contain rows from exactly one of `wt%`, `unrecorded`, or `none`; where several are
  present the most informative wins, in that order, and every other row is excluded and counted in
  `excludedOtherBasis`. A `none` row is never given an imputed concentration. Every prediction
  screen builds its request through `src/lib/concentrationPolicy.ts`: a `wt%` model is sent a
  positive value and a convertible mass unit, an `unrecorded` model a positive value and no unit
  key at all, and a `none` model neither — its candidates are built from component ids alone. No
  concentration is ever defaulted on the user's behalf.
- **Database and file values are never translated.** Molecule names, file names, workspace paths,
  SMILES, InChI and InChIKey, formulas, model names, and imported values are marked
  `translate="no"` and kept out of the catalogue. A literal that is an example of *data* rather
  than interface text — the sample molecule name in the entry form — carries an `i18n-exempt`
  comment naming the reason.
- **Molecule Screening ranks existing library molecules.** LMD does not generate new structures
  there; structure generation is a separate workflow, described under Molecular Design below, and
  it never ranks candidates by a predicted value.
- **Molecular Design accepts an optional chemical-class template.** A design request has three
  independent dimensions: the *chemical class* (an optional template with numbered attachment positions and
  explicit substituent rules), the *target function or property* (recorded as intent — a request
  for an antiwear additive does not make a generated structure an antiwear agent), and the
  *application conditions* (base oil, concentration and unit, other components, test type,
  temperature, load). This release ships three phosphate-ester templates — monoester
  `O=P(OH)2(OR)`, diester `O=P(OH)(OR1)(OR2)`, triester `O=P(OR1)(OR2)(OR3)` — assembled by RDKit
  from a fixed core and permitted substituents (a curated library, the O-substituents of a
  phosphate-ester seed, or BRICS fragments of any seed; BRICS never produces or alters the core).
  In template mode, every complete structure is sanitised and checked by named rules — one P(V) with one P=O and
  three P–O single bonds, no P–C, P–S, P=S, P–N or P–H, no second phosphorus, no charge, no
  counterion, no metal, the template's exact esterification degree, and the requested element,
  size, branching and type limits — so a phosphite, phosphonate, thiophosphate, salt or
  pyrophosphate is rejected by the rule that names it.
  With no template, at least one selected library or user seed is required. The sidecar cuts one
  [BRICS bond](https://www.rdkit.org/docs/source/rdkit.Chem.BRICS.html) at a time and exchanges
  compatible typed halves, using a single joining step. It examines at most 2,000 sampled fragment
  pairs from at most 200 fragments; the random seed, work limits and contributing seed IDs are
  recorded. Unchanged seed structures are excluded. Whole-molecule element, heavy-atom and carbon
  branching limits are stored separately from template substituent limits. General validation checks
  sanitisation, connectedness, filled attachment sites, charge, metals and those whole-molecule
  limits; it does not assign a phosphate-ester class. A missing template is stored as empty, and
  a fragment-pair count is never presented as the total molecular search space.
  Candidates are canonicalised and
  deduplicated by InChIKey, matched against stored molecules by InChIKey and canonical SMILES, and
  stored in `design_candidates` with their template, substituents, seeds, generator version,
  parameters, random seed, generation job, timestamp and validation findings. "Not in this
  workspace" is a fact about the workspace, not a claim of novelty. Synthesis feasibility is
  **not assessed**; structural validity is not evidence that a molecule can be made. A candidate
  enters the molecule library only through an explicit promotion, which re-standardises the
  structure and recalculates its descriptors through the entry form's sidecar path. Predictions
  are stored in `design_predictions`, never read by the dataset builder, and never become training
  labels. The generator's proposal step is an interface (`CandidateSource`); a later graph-based
  genetic optimiser would implement it and pass through the same assembly, validation and
  deduplication. No GAN, VAE or reinforcement-learning generator is trained.
- **A design assessment reports four things separately** for one candidate, one model and one
  application context: *structural compliance* (template rules or general structure checks), *prediction readiness* (a
  usable model, real descriptors, a concentration on the model's basis, the test conditions a
  condition-aware model needs, a compatible test-type scope), *applicability domain* (descriptor
  coverage against the training ranges, nearest training molecules by Tanimoto similarity, the
  spread of ensemble members where the estimator has any, and application-condition coverage
  against the training records), and *validation support* (whether the model's held-out error was
  measured on molecules it had not seen). The status is *supported by validation* only when the
  validation held out linked molecule groups, the candidate lies inside every training feature
  range and every requested condition is covered; *exploratory* when a value could be computed but
  one of those does not hold, with the reasons listed; *unavailable* when an input requirement
  failed, which is an input failure and not statistical uncertainty. No confidence percentage,
  similarity cutoff or prediction interval is produced: similarity and disagreement are reported
  as values and named as evidence. The assessment lists how the model treats each condition — a
  model input, a scope the model was fitted under, a coverage check, or context recorded only — so
  nothing entered is ignored silently. A base oil is never modelled through its representative
  molecule; it is coverage only.
- **A molecule-level model can be fitted under an explicit scope.** The additive-component
  dataset assigns a formulation's measured performance to each additive in it, which is a property
  of the mixture. The training scope can restrict the dataset to single-additive formulations, to
  one test type, and can add the test temperature (°C) and load (N) as features — rows that do not
  record both in a convertible unit are excluded and counted. A model records its scope, and a
  prediction against a scoped model must satisfy it: a condition-aware model refuses a request
  without conditions, and a model fitted on four-ball results refuses an SRV request. Feature
  schema `4` is unchanged, because no existing column changed meaning; older models still predict,
  but report their domain evidence as *not recorded* until retrained.
- **Validation holds out linked molecules, not just formulations.** Rows sharing a molecule or a
  formulation are joined into connected groups, and whole groups are held out, so no molecule
  appears on both sides of the split; imputation and scaling are fitted inside the pipeline on the
  training side only. The held-out score reports its independent molecule count as well as its
  row count. Fewer than five independent groups is reported as *no validation* rather than as a
  validation of one molecule's repeats. A dataset with formulation ids but no molecule ids still
  trains, and says that its score describes repeat formulations better than unseen molecules.
- **Model training covers regression targets only** (Ridge, random forest, histogram gradient
  boosting). There is no classification support, and LMD ships no pre-trained lubricant model —
  every metric shown in the app is measured on the records in your own workspace. The R² figures in
  the Python test suite come from a synthetic fixture with a planted linear relationship; they
  validate the pipeline and say nothing about lubricant-domain accuracy.
- **Two dataset semantics, locked per page.** `additive_component` produces one row per additive
  component per measured result — a molecule-level predictor whose target is the performance of the
  whole mixture. `formulation_aggregate` produces one row per result, combining additive
  descriptors by concentration-weighted mean alongside base-oil properties and composition
  summaries. Molecule Performance Prediction trains and predicts the first; Formulation Prediction
  the second; Molecule Screening uses molecule-level models only. A model records its mode, and a
  prediction addressed to the wrong one is refused rather than answered. Both group by formulation
  for validation splitting.
- **Concentration units are converted only where arithmetic suffices.** wt%, mass fraction, ppm by
  mass, mg/kg, and g/kg all convert to weight percent. mol%, vol%, mg/mL, g/L and molarity need a
  molar mass or a density the workspace does not record, so records using them are excluded from
  training and counted, with a warning naming the unit. A blend that mixes a recorded unit with an
  unrecorded one is excluded too. A workspace that records no units anywhere still trains, with a
  warning saying so. Each model stores the feature schema version and the concentration basis it
  was fitted under; a model from another schema is listed but refuses to predict until retrained.
- **Opening an attached file in an external application is not available.** It would require a
  shell permission this build deliberately does not grant; Export copies the file somewhere you
  can open it instead.
- **Attachment file selection is by absolute path.** A native file-picker dialog is not wired up,
  so the path is typed or pasted.
- **Attachment deletion is compensating, not transactional across both stores.** Files are moved to
  a workspace `.trash` directory, the SQLite transaction commits, and only then are they destroyed;
  a failed transaction restores them. A file that is present but cannot be moved aside aborts the
  delete before any row is touched, so the workspace never gains a file nothing references, and a
  file that cannot be destroyed afterwards is reported in `cleanupFailures` and shown to the user
  rather than hidden behind a "Deleted" message. There is one delete command,
  `delete_attachment_record`, used by every entity type.
- **A generated 3D structure is published by a single database update.** Each generation writes its
  files to versioned paths of their own, so the structure already on disk is never overwritten; the
  `UPDATE` that points the molecule at the new files is the publish. A failure before it leaves the
  previous structure byte-for-byte intact, and the superseded files are removed only afterwards,
  with any that could not be removed reported.
