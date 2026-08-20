# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for LMD's self-contained scientific sidecar."""

from PyInstaller.utils.hooks import collect_all


datas = []
binaries = []
hiddenimports = []

# Mordred discovers descriptor modules dynamically and pandas discovers Excel
# engines at runtime. RDKit and pandas themselves are handled by PyInstaller's
# built-in hooks; collecting all of either package would also bundle tests,
# notebooks, and legacy GUI modules that LMD never executes.
for package in ("mordred", "openpyxl"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

a = Analysis(
    ["run_lmd_sidecar.py"],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "matplotlib",
        "pandas.tests",
        "rdkit.sping",
        "scipy",
        "sklearn",
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
