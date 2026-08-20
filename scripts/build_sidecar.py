#!/usr/bin/env python3
"""Build and install the platform-native LMD sidecar for Tauri."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SIDECAR_ROOT = REPOSITORY_ROOT / "python-sidecar"
TAURI_BINARIES = REPOSITORY_ROOT / "src-tauri" / "binaries"


def target_triple() -> str:
    system = platform.system()
    machine = platform.machine().lower()

    aliases = {
        ("Darwin", "arm64"): "aarch64-apple-darwin",
        ("Darwin", "aarch64"): "aarch64-apple-darwin",
        ("Darwin", "x86_64"): "x86_64-apple-darwin",
        ("Windows", "amd64"): "x86_64-pc-windows-msvc",
        ("Windows", "x86_64"): "x86_64-pc-windows-msvc",
        ("Windows", "arm64"): "aarch64-pc-windows-msvc",
        ("Linux", "x86_64"): "x86_64-unknown-linux-gnu",
        ("Linux", "aarch64"): "aarch64-unknown-linux-gnu",
        ("Linux", "arm64"): "aarch64-unknown-linux-gnu",
    }
    try:
        return aliases[(system, machine)]
    except KeyError as exc:
        raise RuntimeError(f"Unsupported build platform: {system} {machine}") from exc


def ensure_build_environment() -> None:
    if not ((3, 10) <= sys.version_info[:2] < (3, 13)):
        raise RuntimeError(
            "The sidecar must be built with Python 3.10, 3.11, or 3.12; "
            f"current interpreter is {platform.python_version()}."
        )

    required_modules = {
        "PyInstaller": "pyinstaller",
        "rdkit": "rdkit",
        "mordred": "mordred",
        "numpy": "numpy",
        "pandas": "pandas",
        "openpyxl": "openpyxl",
    }
    missing = [label for module, label in required_modules.items() if importlib.util.find_spec(module) is None]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(
            f"Missing sidecar build dependencies: {joined}. Run "
            "python -m pip install -e './python-sidecar[build]' first."
        )


def verify_sidecar(executable: Path) -> None:
    example = SIDECAR_ROOT / "examples" / "required_descriptors_strict.json"
    result = subprocess.run(
        [str(executable), "calculate-required-descriptors", "--input", str(example)],
        check=False,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Sidecar smoke test failed.\n"
            f"stdout: {result.stdout.strip()}\n"
            f"stderr: {result.stderr.strip()}"
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Sidecar returned invalid JSON: {result.stdout!r}") from exc
    data = payload.get("data", {})
    if (
        payload.get("ok") is not True
        or data.get("mode") != "real"
        or data.get("rdkit", {}).get("mode") != "real"
        or data.get("mordred", {}).get("mode") != "real"
    ):
        raise RuntimeError(f"Sidecar smoke test did not use bundled RDKit and Mordred: {payload}")


def build(skip_verify: bool) -> Path:
    ensure_build_environment()
    triple = target_triple()
    executable_suffix = ".exe" if platform.system() == "Windows" else ""
    dist_path = SIDECAR_ROOT / "dist" / triple
    work_path = SIDECAR_ROOT / "build" / "pyinstaller" / triple
    spec_path = SIDECAR_ROOT / "lmd-sidecar.spec"
    cache_path = SIDECAR_ROOT / "build" / "cache" / triple
    pyinstaller_cache = cache_path / "pyinstaller"
    matplotlib_cache = cache_path / "matplotlib"
    pyinstaller_cache.mkdir(parents=True, exist_ok=True)
    matplotlib_cache.mkdir(parents=True, exist_ok=True)
    build_environment = os.environ.copy()
    build_environment["PYINSTALLER_CONFIG_DIR"] = str(pyinstaller_cache)
    build_environment["MPLCONFIGDIR"] = str(matplotlib_cache)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--log-level",
        "WARN",
        "--distpath",
        str(dist_path),
        "--workpath",
        str(work_path),
        str(spec_path),
    ]
    print(f"Building LMD sidecar for {triple} with Python {platform.python_version()}...")
    subprocess.run(command, cwd=SIDECAR_ROOT, env=build_environment, check=True)

    built_executable = dist_path / f"lmd-sidecar{executable_suffix}"
    if not built_executable.is_file():
        raise RuntimeError(f"PyInstaller did not create {built_executable}")
    if not skip_verify:
        print("Running bundled sidecar smoke test...")
        verify_sidecar(built_executable)

    TAURI_BINARIES.mkdir(parents=True, exist_ok=True)
    destination = TAURI_BINARIES / f"lmd-sidecar-{triple}{executable_suffix}"
    shutil.copy2(built_executable, destination)
    if platform.system() != "Windows":
        destination.chmod(destination.stat().st_mode | 0o111)
    print(f"Installed Tauri sidecar: {destination}")
    return destination


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print-target", action="store_true", help="Print this machine's Tauri target triple and exit.")
    parser.add_argument("--skip-verify", action="store_true", help="Skip the bundled executable smoke test.")
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    try:
        if args.print_target:
            print(target_triple())
            return 0
        build(args.skip_verify)
        return 0
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(f"Sidecar build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
