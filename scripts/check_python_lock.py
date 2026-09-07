#!/usr/bin/env python3
"""Fails when the active Python environment does not match `requirements.lock`.

A sidecar built against a different scikit-learn than the one it was tested with is a sidecar whose
models load with a version warning at best and refuse to load at worst — and neither shows up until
a user tries to predict something. The build reads this before it starts, so the mismatch is caught
on the machine that can still fix it.

Reports every difference at once rather than the first, because "install this one version" followed
by the same message about the next package is not a useful way to spend an afternoon.

Usage:
    <python> scripts/check_python_lock.py            check the interpreter running this script
    <python> scripts/check_python_lock.py --manifest print the installed manifest as JSON
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "python-sidecar" / "requirements.lock"

# Packages that only matter while building or testing. A runtime mismatch in one of these cannot
# change what a user's sidecar computes, so it is reported as a warning rather than a failure.
NON_RUNTIME = {
    "altgraph",
    "iniconfig",
    "macholib",
    "packaging",
    "pluggy",
    "pygments",
    "pyinstaller",
    "pyinstaller-hooks-contrib",
    "pytest",
}

LINE = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*==\s*([^\s;#]+)")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def locked_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for line in LOCK.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ";" in stripped:
            from packaging.requirements import Requirement
            marker = Requirement(stripped.split("#", 1)[0]).marker
            if marker is not None and not marker.evaluate():
                continue
        match = LINE.match(stripped)
        if match:
            versions[normalize(match.group(1))] = match.group(2)
    return versions


def installed_versions() -> dict[str, str]:
    from importlib.metadata import distributions

    found: dict[str, str] = {}
    for distribution in distributions():
        name = distribution.metadata["Name"]
        if name:
            found[normalize(name)] = distribution.version
    return found


def compare() -> tuple[list[str], list[str]]:
    locked = locked_versions()
    installed = installed_versions()
    failures: list[str] = []
    warnings: list[str] = []

    for package, expected in sorted(locked.items()):
        actual = installed.get(package)
        if actual == expected:
            continue
        message = (
            f"{package}: locked {expected}, installed {actual or '(absent)'}"
        )
        (warnings if package in NON_RUNTIME else failures).append(message)
    return failures, warnings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        action="store_true",
        help="Print the installed dependency manifest as JSON and exit.",
    )
    arguments = parser.parse_args(argv)

    if arguments.manifest:
        locked = locked_versions()
        installed = installed_versions()
        print(
            json.dumps(
                {
                    "python": sys.version.split()[0],
                    "packages": {
                        package: installed.get(package) for package in sorted(locked)
                    },
                },
                indent=2,
            )
        )
        return 0

    failures, warnings = compare()
    for warning in warnings:
        print(f"warn  {warning}", file=sys.stderr)
    if failures:
        print(
            "\nThe active Python environment does not match python-sidecar/requirements.lock:",
            file=sys.stderr,
        )
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print(
            "\nInstall the locked set before building:\n"
            f"  {sys.executable} -m pip install -r python-sidecar/requirements.lock",
            file=sys.stderr,
        )
        return 1
    print(f"ok   every locked runtime dependency matches ({len(locked_versions())} pinned)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
