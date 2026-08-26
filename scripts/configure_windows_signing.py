#!/usr/bin/env python3
"""Points the Tauri bundler at an imported Windows code-signing certificate.

Tauri v2 reads `bundle.windows.certificateThumbprint`, `digestAlgorithm` and `timestampUrl` from
`tauri.conf.json`. CI imports the PFX into the certificate store, resolves its thumbprint, and
calls this script so the build signs with it.

Usage: python scripts/configure_windows_signing.py <thumbprint> [timestamp-url]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "src-tauri" / "tauri.conf.json"
DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com"


def main(argv: list[str]) -> int:
    if len(argv) < 2 or not argv[1].strip():
        print("A certificate thumbprint is required.", file=sys.stderr)
        return 1
    thumbprint = argv[1].strip()
    timestamp_url = argv[2].strip() if len(argv) > 2 and argv[2].strip() else DEFAULT_TIMESTAMP_URL

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    windows = config.setdefault("bundle", {}).setdefault("windows", {})
    windows["certificateThumbprint"] = thumbprint
    windows["digestAlgorithm"] = "sha256"
    windows["timestampUrl"] = timestamp_url
    CONFIG.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    print(f"Configured Windows signing: thumbprint {thumbprint}, timestamp {timestamp_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
