Place packaged sidecar binaries in this directory.

For macOS Apple Silicon development, Tauri expects:

```text
lmd-sidecar-aarch64-apple-darwin
```

The included macOS file is a development launcher for the local
`python-sidecar` package. Set `LMD_PYTHON_SIDECAR_DIR` if the launcher cannot
discover the package from the app or repository path. It requires Python 3.10
or newer, matching the sidecar package requirement.

For Windows x64 builds, Tauri expects:

```text
lmd-sidecar-x86_64-pc-windows-msvc.exe
```

Build it from `python-sidecar` with PyInstaller, then copy/rename the generated
exe here before running `npm run tauri build`.
