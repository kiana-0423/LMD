Tauri reads platform-native Python sidecars from this directory.

For macOS Apple Silicon development, Tauri expects:

```text
lmd-sidecar-aarch64-apple-darwin
```

The checked-in macOS file is only a development launcher for the local
`python-sidecar` package. It is not suitable for a standalone release.

For Windows x64 builds, Tauri expects:

```text
lmd-sidecar-x86_64-pc-windows-msvc.exe
```

Run `python scripts/build_sidecar.py` from the repository root. It packages the
Python interpreter and dependencies, verifies the executable, and writes the
correct filename here before `tauri build` runs. PyInstaller builds must run on
the target operating system; use `.github/workflows/build-desktop.yml` to build
macOS and Windows artifacts without maintaining both machines locally.
