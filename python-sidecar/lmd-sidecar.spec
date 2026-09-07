# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for LMD's self-contained scientific sidecar.

Every dependency a production command needs must be inside the executable. The user installs one
application; there is no interpreter beside it to fall back on, so a package left out here does
not degrade a feature — it removes it, and only at the moment the user asks for it.

The sidecar's commands need, between them:

  * RDKit and Mordred — descriptors, 2D/3D structures, format conversion;
  * scikit-learn, SciPy, joblib and NumPy — model training, prediction, and reloading;
  * pandas and openpyxl — CSV and XLSX import/export.

Nothing is excluded that any of those import at runtime. What *is* excluded is code no command
ever reaches: test suites, notebook integrations, and legacy GUI toolkits.
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


datas = []
binaries = []
hiddenimports = []

# Mordred discovers descriptor modules dynamically, pandas discovers Excel engines at runtime, and
# scikit-learn's estimators are resolved by name when joblib unpickles a saved model. RDKit,
# pandas, SciPy and NumPy are handled by PyInstaller's own hooks; collecting all of those would
# also bundle tests, notebooks, and legacy GUI modules that LMD never executes.
for package in ("mordred", "networkx", "openpyxl", "sklearn", "joblib", "shap", "numba", "llvmlite"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

# scipy.sparse and scipy.special are imported lazily from inside scikit-learn's estimators, so a
# static scan of our own source never sees them.
# The dependency manifest `scripts/build_sidecar.py` writes just before this spec runs. Bundling it
# is what lets the shipped executable answer `health` with the versions it was actually built from,
# rather than with whatever `importlib.metadata` can find inside a frozen bundle — which, for RDKit,
# NumPy, pandas and SciPy, is nothing.
_metadata = Path(SPECPATH) / "build" / "metadata" / "build-metadata.json"
if _metadata.is_file():
    datas += [(str(_metadata), ".")]

hiddenimports += collect_submodules("scipy.sparse")
hiddenimports += collect_submodules("scipy.special")
hiddenimports += ["scipy._lib.array_api_compat", "scipy.linalg", "scipy.stats"]

a = Analysis(
    ["run_lmd_sidecar.py"],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Only code no command can reach. `matplotlib` is not listed because it is no longer a
    # dependency at all: nothing in the sidecar draws a chart, so it is not installed and there is
    # nothing to exclude.
    excludes=[
        "IPython",
        "pandas.tests",
        "rdkit.sping",
        "sklearn.externals.array_api_compat.torch",
        "sklearn.tests",
        "tkinter",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="lmd-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
