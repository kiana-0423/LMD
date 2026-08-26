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


# The sibling scripts are imported rather than re-implemented, so there is one definition of
# the lock and one of the verification matrix.
sys.path.insert(0, str(Path(__file__).resolve().parent))

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

    # Every module the packaged sidecar must contain. PyInstaller can only bundle what is
    # importable at build time, so a dependency missing here becomes a feature missing from the
    # shipped application — which is how scikit-learn once left the bundle unnoticed.
    required_modules = {
        "PyInstaller": "pyinstaller",
        "rdkit": "rdkit",
        "mordred": "mordred",
        "networkx": "networkx",
        "numpy": "numpy",
        "pandas": "pandas",
        "openpyxl": "openpyxl",
        "scipy": "scipy",
        "sklearn": "scikit-learn",
        "joblib": "joblib",
    }
    missing = [label for module, label in required_modules.items() if importlib.util.find_spec(module) is None]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(
            f"Missing sidecar build dependencies: {joined}. Run "
            "python -m pip install -r python-sidecar/requirements.lock first."
        )

    # Present is not the same as correct. A sidecar built against a different scikit-learn than the
    # one it was tested with produces models that load with a version warning at best, and the
    # failure only appears when a user asks for a prediction.
    from check_python_lock import compare as compare_lock

    failures, warnings = compare_lock()
    for warning in warnings:
        print(f"  warning: {warning}")
    if failures:
        listed = "\n  - ".join(failures)
        raise RuntimeError(
            "The build environment does not match python-sidecar/requirements.lock:\n  - "
            f"{listed}\n\nInstall the locked set first:\n"
            f"  {sys.executable} -m pip install -r python-sidecar/requirements.lock"
        )


def verify_sidecar(executable: Path) -> None:
    """Runs the built executable through every production command.

    The single descriptor smoke test this replaced could not distinguish a complete sidecar from
    one that had lost scikit-learn: descriptors worked either way. The full matrix lives in
    verify_release_sidecar so the build and the release gate check exactly the same things.
    """
    from verify_release_sidecar import VerificationError, run_matrix

    try:
        run_matrix(executable)
    except VerificationError as exc:
        raise RuntimeError(str(exc)) from exc


def build(skip_verify: bool) -> Path:
    ensure_build_environment()
    triple = target_triple()
    executable_suffix = ".exe" if platform.system() == "Windows" else ""
    dist_path = SIDECAR_ROOT / "dist" / triple
    work_path = SIDECAR_ROOT / "build" / "pyinstaller" / triple
    spec_path = SIDECAR_ROOT / "lmd-sidecar.spec"
    cache_path = SIDECAR_ROOT / "build" / "cache" / triple
    pyinstaller_cache = cache_path / "pyinstaller"
    pyinstaller_cache.mkdir(parents=True, exist_ok=True)
    build_environment = os.environ.copy()
    build_environment["PYINSTALLER_CONFIG_DIR"] = str(pyinstaller_cache)

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
    # Written *before* PyInstaller runs so the spec can collect it into the bundle. A manifest that
    # only exists beside the build output is a manifest the shipped executable cannot report, and
    # `health` is exactly where a support request needs to read it.
    write_build_metadata(SIDECAR_ROOT / "build" / "metadata", triple)

    print(f"Building LMD sidecar for {triple} with Python {platform.python_version()}...")
    subprocess.run(command, cwd=SIDECAR_ROOT, env=build_environment, check=True)

    # A second copy beside the executable, for anyone inspecting the build output directly.
    write_build_metadata(dist_path, triple)

    built_executable = dist_path / f"lmd-sidecar{executable_suffix}"
    if not built_executable.is_file():
        raise RuntimeError(f"PyInstaller did not create {built_executable}")
    if not skip_verify:
        print("Verifying every packaged sidecar command...")
        verify_sidecar(built_executable)

    TAURI_BINARIES.mkdir(parents=True, exist_ok=True)
    destination = TAURI_BINARIES / f"lmd-sidecar-{triple}{executable_suffix}"
    shutil.copy2(built_executable, destination)
    if platform.system() != "Windows":
        destination.chmod(destination.stat().st_mode | 0o111)
    print(f"Installed Tauri sidecar: {destination}")
    return destination


def write_build_metadata(dist_path: Path, triple: str) -> Path:
    """Records exactly what this build was made from, beside the executable.

    Version numbers reconstructed after the fact are guesswork. This is written at the moment the
    bundle is produced, from the environment that produced it, so a report about a shipped build
    can be checked against what actually went into it.
    """
    from check_python_lock import installed_versions, locked_versions

    installed = installed_versions()
    metadata = {
        "target_triple": triple,
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "built_on": f"{platform.system()} {platform.machine()}",
        "dependencies": {package: installed.get(package) for package in sorted(locked_versions())},
    }
    dist_path.mkdir(parents=True, exist_ok=True)
    destination = dist_path / "build-metadata.json"
    destination.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Recorded build metadata: {destination}")
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
