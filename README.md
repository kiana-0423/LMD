# Lubricant Materials Database Desktop App

中文名称：润滑材料数据库与智能设计软件

This is a local desktop MVP for lubricant materials research. It uses Tauri v2, React, TypeScript, Ant Design, SQLite, and a Python scientific sidecar.

## Positioning

The app manages the research data chain:

Molecule / Substance -> RDKit + Mordred Descriptors -> Base Oil / Additive -> Formulation -> Experiment Condition -> Performance Result -> Analysis / Design / Prediction

The first MVP focuses on a runnable project skeleton, formal navigation, mock data display, SQLite schema, Rust command skeletons, and Python sidecar CLI mock/fallback behavior.

## Tech Stack

- Desktop: Tauri v2
- Frontend: React + TypeScript + Vite
- UI: Ant Design
- Charts: ECharts dependency prepared
- Local database: SQLite
- Database access: Tauri/Rust commands
- Scientific computing: Python sidecar CLI JSON mode
- Future sidecar dependencies: RDKit, Mordred, pandas, numpy, scikit-learn

## Formal Pages

1. Dashboard
2. Molecule Library
3. Molecule Entry
4. Descriptor Center
5. Base Oil / Additive Library
6. Formulation Library
7. Formulation Entry
8. Experiment & Performance
9. Data Analysis / Design

Molecule Visualization is not a standalone formal page. It is integrated into Molecule Library through the Molecule Detail Drawer.

## Molecule Visualization

Molecule Library keeps the table compact and does not show full descriptor columns. Click a molecule row to open Molecule Detail Drawer with:

- Overview
- 2D Structure
- 3D Structure
- Descriptors Summary
- Formulations
- Files
- Design Notes

2D SVG preview uses mock/RDKit-style SVG in the first MVP. 3D has a command-ready placeholder for future Rust -> Python sidecar RDKit `EmbedMolecule`.

## Mordred Requirement

Mordred descriptors are modeled as required functionality.

- Development MVP can save mock Mordred descriptors.
- Mock records must be marked as `mock`.
- Production mode must not skip Mordred.
- If Mordred is unavailable in production, the workflow must return a clear error.

## Descriptor Storage And Export

Complete RDKit and Mordred descriptors are stored as hidden JSON in `molecule_descriptors.descriptors_json`. Normal Molecule Library tables do not expand the full descriptor set.

Descriptor Center includes:

- Export All Descriptors CSV
- Export ML Descriptor Matrix CSV
- Recalculate Failed Descriptors
- Recalculate All Descriptors
- View Descriptor JSON

CSV exports expand descriptor JSON into columns, including RDKit and Mordred descriptor columns. The ML matrix supports numeric-only output, metadata columns, missing value strategy, and descriptor prefixes.

## Workspace Structure

User data is stored in a Workspace, not in the program installation directory.

```text
LMD_Workspace/
├── lmd.sqlite
├── files/
│   ├── imports/
│   ├── structures/
│   ├── curves/
│   ├── wear_images/
│   ├── pdsc/
│   ├── reports/
│   └── models/
├── exports/
└── backups/
```

Attachment records store relative paths only.

## SQLite

The SQLite schema is centralized in `src-tauri/src/db/schema.rs` and initialized from Rust. It includes:

- molecules
- molecule_descriptors
- base_oils
- additives
- formulations
- formulation_components
- experiments
- performance_results
- attachments
- data_sources
- jobs
- settings

## Python Sidecar

The Python sidecar lives in `python-sidecar/`. It is a CLI JSON process in the MVP:

```bash
cd python-sidecar
python -m lmd_sidecar.main standardize --input examples/standardize.json
python -m lmd_sidecar.main calculate-required-descriptors --input examples/required_descriptors.json
```

It never writes SQLite. Rust/Tauri owns all database writes.

## Install Frontend Dependencies

```bash
npm install
```

## Run Frontend Development Server

```bash
npm run dev
```

## Run Tauri Development App

```bash
npm run tauri dev
```

## Test Python Sidecar

```bash
cd python-sidecar
python -m lmd_sidecar.main standardize --input examples/standardize.json
python -m lmd_sidecar.main rdkit-descriptors --input examples/rdkit_descriptors.json
python -m lmd_sidecar.main mordred-descriptors --input examples/mordred_descriptors.json
python -m lmd_sidecar.main calculate-required-descriptors --input examples/required_descriptors.json
python -m lmd_sidecar.main visualize --input examples/visualize.json
python -m lmd_sidecar.main generate-3d --input examples/generate_3d.json
python -m lmd_sidecar.main import-excel --input examples/import_excel.json
python -m lmd_sidecar.main predict --input examples/predict.json
```

## Package Python Sidecar

Recommended first packaging path:

```bash
cd python-sidecar
pyinstaller --onedir --name lmd-sidecar lmd_sidecar/main.py
```

RDKit packaging is likely the hardest part. Keep `--onedir` until the sidecar is tested on a clean Windows machine without conda.

## Package Tauri

After frontend build and sidecar packaging are wired into `externalBin`:

```bash
npm run tauri build
```

Final targets can include Windows exe, MSI, or NSIS installer.

## Current MVP

- Tauri + React + TypeScript + Vite skeleton
- Ant Design MainLayout and left navigation
- Nine formal pages
- Mock data for molecules, base oils, additives, formulations, experiments, and performance results
- Molecule Detail Drawer with integrated 2D/3D visualization tabs
- Descriptor Center status table and CSV export mock
- Molecule Entry step progress for required RDKit + Mordred descriptor flow
- SQLite schema initialization
- Rust command skeletons
- Python sidecar CLI mock/fallback framework

## TODO

- Persist frontend actions through Rust SQLite commands.
- Replace mock descriptors with real sidecar output.
- Implement descriptor CSV export from SQLite `descriptors_json`.
- Add durable Workspace selection UI.
- Add ECharts visualizations.
- Package Python sidecar with RDKit and Mordred.
- Configure Tauri `externalBin` for packaged sidecar.
