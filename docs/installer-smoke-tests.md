# Installer smoke tests

A successful compile says nothing about whether an installed package runs on a machine without
developer tools. These checks must be run on real, clean systems before any release is described as
working for end users.

"Clean" means a machine (or a fresh VM snapshot) with **no** Node.js, Rust, Python, Conda, RDKit,
or Mordred installed, and no LMD workspace from a previous run.

Record the result of every step. A step that is skipped is a step that failed.

## Shared preparation

1. Build installers on native runners: `npm run desktop:build:mac` on Apple Silicon macOS and
   `npm run desktop:build:windows` on Windows x64, or download both artifacts from the
   **Build desktop installers** workflow.
2. Copy the installer to the clean machine over a file share or USB — do not clone the repository
   there, or the machine stops being clean.
3. Confirm the toolchains really are absent:
   ```bash
   node --version; python3 --version; cargo --version; conda --version   # all must fail
   ```

## macOS (Apple Silicon)

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Mount the DMG and drag LMD to Applications | Copy completes |
| 2 | First launch | App opens. Unsigned builds need right-click → Open; note the Gatekeeper prompt |
| 3 | Sidebar status badge | Shows "Python Sidecar: Live", **not** "Unavailable" and **not** the browser demo badge |
| 4 | Settings → workspace path | Points inside `~/Library/Application Support/com.lmd.desktop/` |
| 5 | Molecule Entry → save `CCO` | Saves with RDKit and Mordred descriptor records; descriptor count is in the thousands, not single digits |
| 6 | Descriptor Center | Molecule shows RDKit and Mordred as `calculated`, mode `real` |
| 7 | Molecule Sketcher | Ketcher canvas loads, a structure can be drawn, edited, exported, and its descriptors calculated. **This is the CSP test** — see below |
| 8 | Import a CSV of 25+ base oils | All rows import; the count matches the file |
| 9 | Train a model | Either a trained model with metrics, or an explicit "needs at least N records" error — never a fabricated score |
| 10 | Export All Descriptors CSV | File appears under `<workspace>/exports/` and contains the real molecules |
| 11 | Quit and relaunch | Every record persists |
| 12 | Workspace upgrade | Copy a workspace from the previous release into place, launch, confirm `PRAGMA user_version` is 3 and no rows were lost |

## Windows x64

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Run the NSIS `-setup.exe` on a machine with no internet | Installs, including the offline WebView2 runtime |
| 2 | Launch | App opens without a WebView2 download prompt |
| 3 | Steps 3–11 from the macOS table | Same expected results |
| 4 | Uninstall via Apps & Features | Application files removed |
| 5 | Confirm the workspace survived the uninstall | `%APPDATA%\com.lmd.desktop\LMD_Workspace` still holds `lmd.sqlite` |
| 6 | Reinstall and launch | Previous records are still present |
| 7 | Repeat 1–6 with the MSI | Same results |

## The CSP / Ketcher check (step 7)

The shipped policy is:

```
script-src 'self' 'wasm-unsafe-eval' blob:
```

`'wasm-unsafe-eval'` is required because `ketcher-standalone`'s bundled indigo worker calls
`WebAssembly.instantiate`. Static analysis of the production bundle finds no `eval(` and no
`new Function(` call, which is why the far broader `'unsafe-eval'` is **not** granted.

That reasoning is verified statically, not at runtime. On the clean machine:

1. Open the Molecule Sketcher.
2. Open the developer console if the build allows it, or watch for a blank canvas.
3. Draw a structure, import a MOL file, export SMILES, and calculate descriptors.

If the canvas fails to load with a CSP violation naming `script-src`, restore the previous value in
`src-tauri/tauri.conf.json`:

```
script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:
```

and record in this file exactly which Ketcher operation required it. Do not relax any other
directive, and do not add a shell permission.

## Signing

Without secrets, CI produces **unsigned** artifacts. They are for internal testing only and must
not be described as production-ready. The workflow writes the signing state of every artifact to
the job summary, so a run always says which it produced.

### What the workflow does when secrets are present

**macOS** (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`):

1. Decodes the base64 `.p12` into the runner temp directory.
2. Creates and unlocks a temporary keychain, and adds it to the search list.
3. Imports the certificate with `-T /usr/bin/codesign`.
4. Runs `security set-key-partition-list`, without which `codesign` blocks on a GUI prompt that
   never appears on a runner.
5. Resolves the identity with `security find-identity -v -p codesigning` and exports it as
   `APPLE_SIGNING_IDENTITY`.
6. After the build, runs `codesign --verify --deep --strict`. The build fails if verification
   fails, so a run cannot report "signed" without proof.
7. Deletes the temporary keychain, even when the build failed.

Notarization additionally needs `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and
`APPLE_TEAM_ID`. When they are present, the workflow runs `spctl --assess --type execute` and
warns if Gatekeeper rejects the bundle. When they are absent it warns that the artifact is signed
but **not** notarized.

**Windows** (`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`):

1. Decodes the base64 `.pfx` and imports it into `Cert:\CurrentUser\My`.
2. Reads the thumbprint from the imported certificate.
3. Calls `scripts/configure_windows_signing.py`, which writes `certificateThumbprint`,
   `digestAlgorithm: sha256` and a timestamp URL into `tauri.conf.json`.
4. After the build, checks every `.exe` and `.msi` with `Get-AuthenticodeSignature` and fails the
   job unless the status is `Valid`.

### Still outstanding regardless of CI

Signature verification in CI proves the artifact is signed. It does not prove any of these, which
need real machines:

- Gatekeeper behaviour on first launch of a downloaded, quarantined DMG.
- That notarization stapling survives download and transfer.
- SmartScreen reputation on the NSIS installer.
- MSI install, uninstall, and reinstall over an existing workspace.
- Clean-machine operation with no Node.js, Rust, Python, or Conda present.
