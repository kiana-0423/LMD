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

## Install

```bash
cd python-sidecar
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Recommended chemistry dependencies:

```bash
pip install rdkit mordred pandas numpy scikit-learn
```

RDKit is often easier to install through conda-forge:

```bash
conda install -c conda-forge rdkit mordred pandas numpy scikit-learn
```

## Test Commands

```bash
python -m lmd_sidecar.main standardize --input examples/standardize.json
python -m lmd_sidecar.main rdkit-descriptors --input examples/rdkit_descriptors.json
python -m lmd_sidecar.main mordred-descriptors --input examples/mordred_descriptors.json
python -m lmd_sidecar.main calculate-required-descriptors --input examples/required_descriptors.json
python -m lmd_sidecar.main visualize --input examples/visualize.json
python -m lmd_sidecar.main generate-3d --input examples/generate_3d.json
python -m lmd_sidecar.main import-excel --input examples/import_excel.json
python -m lmd_sidecar.main predict --input examples/predict.json
```

Development mode can return mock/fallback data when optional dependencies are absent. Production mode must not skip Mordred descriptors; call `calculate-required-descriptors` with `allow_mock: false` to enforce that behavior.

## Packaging Note

The first Windows packaging target should use PyInstaller `--onedir` rather than `--onefile`, because RDKit packaging is usually the hardest part.

```bash
pyinstaller --onedir --name lmd-sidecar lmd_sidecar/main.py
```
