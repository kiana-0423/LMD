# LMD

## Overview

LMD is a local desktop database and intelligent-design application for lubricant-material research. It organizes molecules, descriptors, base oils, additives, formulations, experimental conditions, performance results, analysis, and prediction in one local workflow.

The project is currently an MVP. It provides a working Tauri desktop foundation, local SQLite storage, a Python scientific-computing sidecar, molecule drawing and import workflows, descriptor management, formulation and experimental data pages, and data-mining entry points.

## Technology

- React, TypeScript, Ant Design, and Vite provide the user interface.
- Tauri 2 and Rust provide the desktop shell, SQLite initialization, local file management, database commands, and sidecar integration.
- Python provides SMILES standardization, RDKit and Mordred descriptors, 2D/3D structure generation, Excel preprocessing, and prediction placeholders.
- SQLite stores local application data in the workspace database `lmd.sqlite`.

## Requirements

These requirements are for developers and release builders only. People who install a finished LMD package do not need Node.js, Rust, Python, Conda, RDKit, or SQLite.

- Node.js `20.19+` or `22.12+`
- npm
- Stable Rust and Cargo
- Python `3.10–3.12`
- RDKit, Mordred, NumPy, pandas, SciPy, scikit-learn, and Matplotlib
- Platform-specific Tauri build prerequisites

RDKit is often easier to install from conda-forge than from pip.

## Development Setup

Install frontend dependencies:

```bash
npm install --include=dev
```

Create the Python environment and install the sidecar:

```bash
conda create -n lmd-build python=3.11 -y
conda activate lmd-build
conda install -c conda-forge rdkit numpy pandas scipy scikit-learn matplotlib -y
python -m pip install mordred pyinstaller
python -m pip install -e ./python-sidecar
```

Start the complete desktop application:

```bash
export PYTHON="$CONDA_PREFIX/bin/python"
export LMD_PYTHON_SIDECAR_DIR="$PWD/python-sidecar"
npm run tauri dev
```

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

This first packages Python, RDKit, Mordred, pandas, and the other runtime libraries into a native sidecar, validates the sidecar, and then creates the Tauri app and DMG. The DMG is written under `src-tauri/target/release/bundle/dmg/`.

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

- `src/`: React application, features, API wrappers, localization, and mock data
- `src-tauri/`: Rust backend, SQLite schema, Tauri commands, paths, and bundle configuration
- `python-sidecar/`: Python CLI and scientific-computing services
- `public/`: frontend static assets
- `asset/`: source design assets

Generated directories such as `dist/`, `node_modules/`, `src-tauri/target/`, Python environments, and caches should not be committed as source.

## Main Features

- Dashboard with live SQLite workspace statistics
- Molecule Library with 2D/3D views and descriptor summaries
- Molecule Entry and Ketcher-based Molecule Sketcher
- RDKit and Mordred Descriptor Center
- Base Oils / Additives library
- Formulation Library and Formulation Entry
- Experiments & Performance entry
- Molecule-performance prediction
- Formulation prediction
- Molecule design
- Import / Export workflows
- English, Simplified Chinese, and Japanese settings, with English as the default

## Architecture Notes

React calls Rust through Tauri commands. Rust owns all SQLite writes and invokes the Python sidecar through a JSON CLI protocol. The sidecar does not write directly to SQLite.

Structure files, exports, attachments, reports, and models should be stored under the workspace directory. The database should store relative paths.

Production mode should use real descriptor calculations and must not silently substitute mock results for unavailable scientific dependencies.

## Current Limitations

- Some create and edit workflows remain MVP placeholders.
- Direct Rust-side expansion of `descriptors_json` for exports is not complete.
- Signed installers still require clean-machine validation, especially on Windows.
- Batch queues, complete model training, prediction services, and comprehensive import validation need further development.
- Test coverage should continue to expand across the frontend, Rust database layer, and Python services.
