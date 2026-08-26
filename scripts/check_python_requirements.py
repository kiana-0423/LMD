#!/usr/bin/env python3
"""Fails when the repository states more than one Python requirement.

The version range lives in four places: the sidecar's `pyproject.toml`, the build script's runtime
guard, the Node-side resolver, and the README. Three of them agreeing is not enough — the one that
disagrees is the one a developer will read, and a mismatch between them is how "install Python
3.10+" ends up next to a build script that refuses anything below 3.11.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = ((3, 10), (3, 13))  # inclusive lower bound, exclusive upper bound


def pyproject_range() -> tuple[tuple[int, int], tuple[int, int]]:
    text = (ROOT / "python-sidecar" / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'requires-python\s*=\s*">=(\d+)\.(\d+),<(\d+)\.(\d+)"', text)
    if not match:
        raise SystemExit("pyproject.toml does not declare requires-python as '>=X.Y,<A.B'.")
    low = (int(match.group(1)), int(match.group(2)))
    high = (int(match.group(3)), int(match.group(4)))
    return low, high


def build_script_range() -> tuple[tuple[int, int], tuple[int, int]]:
    text = (ROOT / "scripts" / "build_sidecar.py").read_text(encoding="utf-8")
    match = re.search(
        r"if not \(\((\d+), (\d+)\) <= sys\.version_info\[:2\] < \((\d+), (\d+)\)\)", text
    )
    if not match:
        raise SystemExit("build_sidecar.py does not guard its interpreter version as expected.")
    return (int(match.group(1)), int(match.group(2))), (int(match.group(3)), int(match.group(4)))


def resolver_range() -> tuple[tuple[int, int], tuple[int, int]]:
    text = (ROOT / "scripts" / "resolve-python.mjs").read_text(encoding="utf-8")
    low = re.search(r"export const MINIMUM_VERSION = \[(\d+), (\d+)\]", text)
    high = re.search(r"export const MAXIMUM_VERSION_EXCLUSIVE = \[(\d+), (\d+)\]", text)
    if not low or not high:
        raise SystemExit("resolve-python.mjs does not declare its supported range as expected.")
    return (int(low.group(1)), int(low.group(2))), (int(high.group(1)), int(high.group(2)))


def readme_mentions_the_range(low: tuple[int, int], high: tuple[int, int]) -> bool:
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    newest = f"{high[0]}.{high[1] - 1}"
    oldest = f"{low[0]}.{low[1]}"
    # Either "3.10-3.12" or "3.10 to 3.12", in any of the places the README names it.
    return bool(re.search(rf"{re.escape(oldest)}\s*(?:-|–|to)\s*{re.escape(newest)}", text))


def main() -> int:
    problems: list[str] = []
    for label, actual in (
        ("python-sidecar/pyproject.toml", pyproject_range()),
        ("scripts/build_sidecar.py", build_script_range()),
        ("scripts/resolve-python.mjs", resolver_range()),
    ):
        if actual != EXPECTED:
            problems.append(f"{label} declares {actual}, expected {EXPECTED}")

    if not readme_mentions_the_range(*EXPECTED):
        problems.append(
            "README.md does not state the supported range as "
            f"{EXPECTED[0][0]}.{EXPECTED[0][1]}-{EXPECTED[1][0]}.{EXPECTED[1][1] - 1}"
        )

    if problems:
        print("Python requirements disagree:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    low, high = EXPECTED
    print(f"ok   Python {low[0]}.{low[1]}-{high[0]}.{high[1] - 1} declared consistently")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
