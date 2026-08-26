#!/usr/bin/env python3
"""Install the lightweight local sidecar launcher used by `tauri dev`."""

from __future__ import annotations

import platform
import shutil
import sys
from pathlib import Path

from build_sidecar import TAURI_BINARIES, target_triple


SCRIPT_ROOT = Path(__file__).resolve().parent


def main() -> int:
    triple = target_triple()
    suffix = ".exe" if platform.system() == "Windows" else ""
    destination = TAURI_BINARIES / f"lmd-sidecar-{triple}{suffix}"
    if platform.system() == "Windows":
        if destination.is_file() and destination.read_bytes()[:2] == b"MZ":
            print(f"Using existing Windows development sidecar: {destination}")
            return 0
        print(
            "Windows development requires a native sidecar. Run `python scripts/build_sidecar.py` first.",
            file=sys.stderr,
        )
        return 1

    launcher = SCRIPT_ROOT / "lmd-sidecar-dev.sh"
    TAURI_BINARIES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(launcher, destination)
    destination.chmod(destination.stat().st_mode | 0o111)
    print(f"Installed development sidecar launcher: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
