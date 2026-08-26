# LMD Python Sidecar

This sidecar provides local scientific calculation commands for the Lubricant Materials Database Desktop App.

The sidecar does not create, modify, or write SQLite databases. React calls Rust/Tauri commands, Rust calls this CLI, and Rust owns all database writes.

## CLI Format

All commands read JSON from `--input` and print only the final JSON result to stdout. Logs and errors go to stderr.

Success:

```json
{"ok":true,"data":{},"warnings":[]}
```

Failure:

```json
{"ok":false,"error":"error message","warnings":[]}
```

## Development Install

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

RDKit is often easier to install through conda-forge before installing this package:

If the pip RDKit wheel is not available for your platform, install RDKit first with conda, then run `pip install -e .` in the activated environment. A typical conda path is `conda install -c conda-forge rdkit`, followed by the editable install command above.

## Test Commands

```bash
python -m lmd_sidecar.main standardize --input examples/standardize.json
python -m lmd_sidecar.main rdkit-descriptors --input examples/rdkit_descriptors.json
python -m lmd_sidecar.main mordred-descriptors --input examples/mordred_descriptors.json
python -m lmd_sidecar.main calculate-required-descriptors --input examples/required_descriptors.json
python -m lmd_sidecar.main visualize --input examples/visualize.json
python -m lmd_sidecar.main generate-3d --input examples/generate_3d.json
python -m lmd_sidecar.main import-excel --input examples/import_excel.json
python -m lmd_sidecar.main import-excel --input examples/import_base_oils.json
python -m lmd_sidecar.main import-excel --input examples/import_additives.json
python -m lmd_sidecar.main predict --input examples/predict.json
```

Development mode can return mock/fallback data when optional dependencies are absent. Production mode must not skip Mordred descriptors; call `calculate-required-descriptors` with `allow_mock: false` to enforce that behavior.

## Build a Self-contained Sidecar

Use Python 3.10, 3.11, or 3.12. Install the pinned build environment from this directory, then run the cross-platform builder:

```bash
python -m pip install -r requirements.lock
cd ..
python scripts/build_sidecar.py
```

The script builds a PyInstaller single-file executable, verifies that its bundled RDKit performs a real calculation, and copies it into `src-tauri/binaries` using Tauri's target-triple naming convention. End users therefore do not need Python, Conda, or the scientific packages.

PyInstaller is not a cross-compiler. Run the command on every operating system and CPU architecture that you release, or use the repository's GitHub Actions workflow. Expected names include:

```text
lmd-sidecar-aarch64-apple-darwin
lmd-sidecar-x86_64-pc-windows-msvc.exe
```

The source tree does not track either launcher or executable. `tauri dev`
generates an ignored local launcher automatically; `python
scripts/build_sidecar.py` replaces it locally with the real packaged executable
before a production build. The release hook rejects missing files and launch
scripts. Generated executables are release artifacts and should not be
committed.

Single-file mode is easy to ship but extracts its Python runtime into a temporary directory at startup. If startup later becomes a performance issue, migrate the Tauri resource layout to PyInstaller's one-directory mode.

## Package the Desktop App

From the repository root, with the build environment activated:

```bash
# macOS
npm run desktop:build:mac

# Windows (run on Windows)
npm run desktop:build:windows
```
