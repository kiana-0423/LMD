#!/usr/bin/env python3
"""Install the lightweight local sidecar launcher used by `tauri dev`."""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from build_sidecar import SIDECAR_ROOT, TAURI_BINARIES, target_triple


SCRIPT_ROOT = Path(__file__).resolve().parent


def install_launcher(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Cargo watches this resource's mtime. copy2 preserves the old source timestamp,
    # so switching from a packaged executable back to dev can leave the old binary
    # in target/debug. Give every installation a fresh timestamp.
    shutil.copyfile(SCRIPT_ROOT / "lmd-sidecar-dev.sh", destination)
    destination.chmod(destination.stat().st_mode | 0o111)


def check_launcher(destination: Path) -> None:
    # Exercise the actual launcher, including its interpreter resolution, before
    # starting Vite/Tauri. Health must work with all runtime dependencies present.
    with tempfile.TemporaryDirectory(prefix="lmd-dev-health-") as temporary:
        payload = Path(temporary) / "health.json"
        payload.write_text("{}", encoding="utf-8")
        result = subprocess.run(
            [str(destination), "health", "--input", str(payload)],
            cwd=SIDECAR_ROOT.parent,
            capture_output=True,
            text=True,
            timeout=60,
        )
    try:
        response = json.loads(result.stdout)
    except ValueError:
        response = {}
    data = response.get("data") or {}
    if result.returncode != 0 or response.get("ok") is not True or data.get("mode") != "real":
        detail = result.stderr.strip() or response.get("error") or data.get("missing") or result.stdout.strip()
        raise RuntimeError(f"Development sidecar health check failed: {detail}")
    print(f"Development sidecar healthy: Python {data.get('python_version', 'unknown')}")


def main() -> int:
    triple = target_triple()
    suffix = ".exe" if platform.system() == "Windows" else ""
    destination = TAURI_BINARIES / f"lmd-sidecar-{triple}{suffix}"
    if platform.system() == "Windows":
        if destination.is_file() and destination.read_bytes()[:2] == b"MZ":
            check_launcher(destination)
            print(f"Using existing Windows development sidecar: {destination}")
            return 0
        print(
            "Windows development requires a native sidecar. Run `python scripts/build_sidecar.py` first.",
            file=sys.stderr,
        )
        return 1

    install_launcher(destination)
    check_launcher(destination)
    print(f"Installed development sidecar launcher: {destination}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"LMD: {exc}", file=sys.stderr)
        print(
            "Check LMD_PYTHON/PYTHON and the active environment. Install dependencies with:\n"
            f"  {sys.executable} -m pip install -r python-sidecar/requirements.lock",
            file=sys.stderr,
        )
        raise SystemExit(1)
