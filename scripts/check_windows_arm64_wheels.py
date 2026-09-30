#!/usr/bin/env python3
"""Check whether the locked sidecar can be installed natively on Windows ARM64.

The check deliberately requires wheels for packages with native code. Falling back to an sdist
during a release build makes the result depend on undeclared compilers and SDKs, and PyInstaller
cannot turn an AMD64 extension into an ARM64 one. Explicitly reviewed pure-Python sdists are allowed.
The JSON report is written even when packages are missing so CI leaves useful evidence instead of
only pip's final resolver error.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from packaging.requirements import Requirement
from packaging.tags import compatible_tags, cpython_tags
from packaging.utils import InvalidWheelFilename, canonicalize_name, parse_wheel_filename


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "python-sidecar" / "requirements.lock"
TARGET_PLATFORM = "win_arm64"

# Mordred 1.2.0 is published only as an sdist, but it contains Python modules rather than compiled
# extensions. It is already installed from that exact archive on every supported platform. Keep
# this list deliberately small: adding a package here is an assertion that no target-native code
# is produced during installation.
PURE_PYTHON_SDISTS = {"mordred"}


def marker_environment(python_version: tuple[int, int]) -> dict[str, str]:
    major, minor = python_version
    return {
        "implementation_name": "cpython",
        "implementation_version": f"{major}.{minor}.0",
        "os_name": "nt",
        "platform_machine": "ARM64",
        "platform_python_implementation": "CPython",
        "platform_release": "10",
        "platform_system": "Windows",
        "platform_version": "10.0",
        "python_full_version": f"{major}.{minor}.0",
        "python_version": f"{major}.{minor}",
        "sys_platform": "win32",
    }


def locked_requirements(
    lock: Path = LOCK, python_version: tuple[int, int] = (3, 12)
) -> list[Requirement]:
    environment = marker_environment(python_version)
    requirements: list[Requirement] = []
    for number, raw in enumerate(lock.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        requirement = Requirement(line)
        if requirement.marker is None or requirement.marker.evaluate(environment):
            if len(requirement.specifier) != 1 or next(iter(requirement.specifier)).operator != "==":
                raise ValueError(f"{lock}:{number} is not pinned exactly: {line}")
            requirements.append(requirement)
    return requirements


def target_tags(python_version: tuple[int, int]) -> set[Any]:
    interpreter = f"cp{python_version[0]}{python_version[1]}"
    return set(cpython_tags(python_version, platforms=[TARGET_PLATFORM])) | set(
        compatible_tags(python_version, interpreter=interpreter, platforms=[TARGET_PLATFORM])
    )


def compatible_wheels(
    files: list[dict[str, Any]], python_version: tuple[int, int]
) -> list[str]:
    accepted = target_tags(python_version)
    compatible: list[str] = []
    for item in files:
        filename = str(item.get("filename", ""))
        if not filename.endswith(".whl"):
            continue
        try:
            _, _, _, wheel_tags = parse_wheel_filename(filename)
        except InvalidWheelFilename:
            continue
        if wheel_tags & accepted:
            compatible.append(filename)
    return sorted(compatible)


def fetch_release(requirement: Requirement, timeout: float = 30.0) -> dict[str, Any]:
    version = next(iter(requirement.specifier)).version
    name = urllib.parse.quote(canonicalize_name(requirement.name), safe="")
    url = f"https://pypi.org/pypi/{name}/{urllib.parse.quote(version, safe='')}/json"
    request = urllib.request.Request(url, headers={"User-Agent": "LMD-Windows-ARM64-audit/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def audit(
    requirements: list[Requirement], python_version: tuple[int, int]
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for requirement in requirements:
        version = next(iter(requirement.specifier)).version
        try:
            release = fetch_release(requirement)
            wheels = compatible_wheels(release.get("urls", []), python_version)
            canonical_name = canonicalize_name(requirement.name)
            pure_python_sdist = canonical_name in PURE_PYTHON_SDISTS and any(
                item.get("packagetype") == "sdist" for item in release.get("urls", [])
            )
            results.append(
                {
                    "package": canonical_name,
                    "version": version,
                    "compatible": bool(wheels) or pure_python_sdist,
                    "install_source": (
                        "wheel" if wheels else "pure-python-sdist" if pure_python_sdist else None
                    ),
                    "wheels": wheels,
                }
            )
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            errors.append(
                {"package": canonicalize_name(requirement.name), "version": version, "error": str(exc)}
            )
    return results, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default="3.12", help="Target CPython major.minor (default: 3.12)")
    parser.add_argument("--report", type=Path, help="Write the complete audit as JSON")
    args = parser.parse_args()
    try:
        python_version = tuple(int(part) for part in args.python.split("."))
        if len(python_version) != 2:
            raise ValueError
    except ValueError:
        parser.error("--python must be major.minor, for example 3.12")

    requirements = locked_requirements(python_version=python_version)
    results, errors = audit(requirements, python_version)
    missing = [item for item in results if not item["compatible"]]
    report = {
        "target": f"CPython {args.python} / {TARGET_PLATFORM}",
        "lock": str(LOCK.relative_to(ROOT)),
        "ready": not missing and not errors,
        "packages": results,
        "errors": errors,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    for item in results:
        status = "ok  " if item["compatible"] else "MISS"
        detail = (
            item["wheels"][0]
            if item["wheels"]
            else "declared pure-Python sdist"
            if item["install_source"] == "pure-python-sdist"
            else "no compatible wheel"
        )
        print(f"{status} {item['package']}=={item['version']}: {detail}")
    for item in errors:
        print(f"ERR  {item['package']}=={item['version']}: {item['error']}", file=sys.stderr)
    if missing or errors:
        print(
            "\nWindows ARM64 release build is blocked. Every locked native dependency must "
            "publish a CPython ARM64 wheel, or be supplied by a separate reproducible source-build "
            "stage before packaging.",
            file=sys.stderr,
        )
        return 1
    print(f"ok   all {len(results)} locked packages have compatible Windows ARM64 artifacts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
