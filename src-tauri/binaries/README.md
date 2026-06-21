Place packaged sidecar binaries in this directory.

For Windows x64 builds, Tauri expects:

```text
lmd-sidecar-x86_64-pc-windows-msvc.exe
```

Build it from `python-sidecar` with PyInstaller, then copy/rename the generated
exe here before running `npm run tauri build`.
