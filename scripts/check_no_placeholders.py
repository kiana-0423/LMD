#!/usr/bin/env python3
"""Architectural guard against mock and placeholder leakage into production code.

What this script enforces, precisely:

  1. Production feature code does not import the browser-demo modules.
  2. Every visible button has a real handler. A button that is only ever disabled, or whose only
     "behaviour" is a `loading` flag, counts as a no-op and fails.
  3. No fixed mock file path appears outside demo or test code.
  4. No Rust command returns a hard-coded scientific value.
  5. No fabricated data table is declared inline in a production component.
  6. A list of obsolete production phrases does not reappear.

What this script does NOT do: it says nothing about whether a calculation is scientifically
correct. It checks structure and provenance, not numerical validity. Correctness is the job of the
Rust, Python, and frontend test suites.

Browser-demo modules are allow-listed explicitly, by path, so adding a new one is a deliberate act.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[1]

# --- Modules that may legitimately contain demo data ---------------------------------------
# Everything the browser demo needs lives under `src/lib/demo/`, and nothing outside that folder
# imports it. The only door in is the guarded dynamic import in `src/lib/tauri.ts`, which a build
# without `VITE_DEMO_MODE=true` never takes — so the folder and its contents are dropped from a
# desktop bundle entirely.
DEMO_MODULES = {
    "src/lib/demo/api.mock.ts",
    "src/lib/demo/mockData.ts",
    "src/lib/demo/mockStructure.ts",
    "src/lib/demo/adapter.ts",
    "src/lib/demo/csv.ts",
}

# Only the demo folder itself. The API layer no longer imports a demo module at all: it calls one
# gateway, and the gateway decides. That is what makes the separation checkable rather than a
# convention.
DEMO_IMPORT_ALLOWED_PREFIXES = ("src/lib/demo/",)

PRODUCTION_ROOTS = ["src/features", "src/components", "src/layouts", "src/routes", "src/i18n"]

FORBIDDEN_MARKERS = [
    "queued_mock",
    "opened_mock",
    "mock_csv_ready",
    'prediction": "mock"',
    "future release",
    "correlation placeholder",
    "dangerouslySetInnerHTML",
    '"csp": null',
    # Obsolete promises from earlier iterations. Candidate generation does not exist: the app
    # ranks molecules that are already in the library.
    "Performance Comparison Placeholder",
    "Molecule design task created",
    "Molecule Design",
    "candidate generation",
    "generate new molecules",
    "generated candidate structures",
]

# Fixed sample paths that must never reach a user's screen.
MOCK_PATH_PATTERN = re.compile(r"""["'][^"']*\bmock[-_][A-Za-z0-9_.-]*\.(csv|pdf|xlsx?|json|sdf|mol|pdb)["']""", re.IGNORECASE)

# A Rust command returning a hard-coded scientific number rather than reading the database.
RUST_FIXED_SCIENCE = re.compile(
    r'"(prediction_score|predicted_friction_coefficient|predicted_wear_scar_diameter|'
    r'predicted_oxidation_temperature|predicted_extreme_pressure_value|pearson|spearman)"\s*:\s*-?\d'
)


def is_test_path(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & {"__tests__", "tests"}) or path.name.endswith((".test.ts", ".test.tsx"))


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def iter_files(root: Path, subdirectory: str, suffixes: tuple[str, ...]) -> list[Path]:
    base = root / subdirectory
    if not base.exists():
        return []
    return sorted(p for p in base.rglob("*") if p.is_file() and p.suffix in suffixes)


def check_demo_imports(root: Path) -> list[str]:
    """Production code must not import a browser-demo module."""
    findings = []
    demo_names = {Path(module).stem for module in DEMO_MODULES}
    pattern = re.compile(r"""from\s+["']([^"']+)["']""")
    for subdirectory in PRODUCTION_ROOTS + ["src/lib"]:
        for path in iter_files(root, subdirectory, (".ts", ".tsx")):
            rel = relative(root, path)
            if is_test_path(path) or rel in DEMO_MODULES:
                continue
            if rel.startswith(DEMO_IMPORT_ALLOWED_PREFIXES):
                continue
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                match = pattern.search(line)
                if not match:
                    continue
                target = Path(match.group(1)).name
                if target in demo_names:
                    findings.append(
                        f"{rel}:{line_number}: production module imports demo module '{target}'"
                    )
    return findings


# Ant Design buttons and native ones alike.
BUTTON_OPEN = re.compile(r"<(?:Button|button)\b")
# Attributes that constitute real behaviour. `disabled` and `loading` are deliberately absent:
# a permanently disabled or merely spinning button still does nothing when pressed.
REAL_HANDLERS = ("onClick", "onOk", "onSubmit", "onPressEnter", 'htmlType="submit"', "{...")


def attribute_span(text: str, match: re.Match[str]) -> str:
    """Returns the attributes of one JSX opening tag, tolerating nested braces and strings."""
    depth = 0
    for index in range(match.end(), len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        elif char == ">" and depth == 0:
            return text[match.end() : index]
    return text[match.end() :]


def check_buttons_have_behaviour(root: Path) -> list[str]:
    """Every visible button must do something when pressed.

    A button whose only attributes are `disabled` or `loading` is a no-op: `disabled` alone means
    it can never be pressed, and `loading` alone means it spins without acting. Both were treated
    as sufficient by the previous version of this check, which is how a handler-less Open button
    reached the Files panel.
    """
    findings = []
    for subdirectory in PRODUCTION_ROOTS:
        for path in iter_files(root, subdirectory, (".tsx",)):
            if is_test_path(path):
                continue
            text = path.read_text(encoding="utf-8")
            for match in BUTTON_OPEN.finditer(text):
                attributes = attribute_span(text, match)
                if any(handler in attributes for handler in REAL_HANDLERS):
                    continue
                line_number = text.count("\n", 0, match.start()) + 1
                reason = "has no onClick or submit handler"
                if "disabled" in attributes and "loading" not in attributes:
                    reason = "is permanently disabled with no handler"
                elif "loading" in attributes:
                    reason = "only shows a loading state and never acts"
                findings.append(f"{relative(root, path)}:{line_number}: button {reason}")
    return findings


# An inline array of objects carrying scientific-looking fields is a fabricated table.
FABRICATED_ROW_FIELDS = (
    "formulation",
    "concentration",
    "performance",
    "prediction",
    "score",
    "frictionCoefficient",
    "wearScar",
    "descriptor",
)


def check_no_fabricated_tables(root: Path) -> list[str]:
    """Rejects a scientific data table declared inline in a production component.

    The fabricated Related Formulations row was exactly this shape: a `const rows = [{ ... }]`
    literal holding a formulation name, a concentration and a performance figure. Real tables get
    their rows from an API call, never from a literal.
    """
    findings = []
    literal = re.compile(r"(?:const|let)\s+\w*[Rr]ows?\w*\s*(?::[^=]+)?=\s*\[\s*\{", re.MULTILINE)
    for subdirectory in PRODUCTION_ROOTS:
        for path in iter_files(root, subdirectory, (".tsx", ".ts")):
            if is_test_path(path):
                continue
            text = path.read_text(encoding="utf-8")
            for match in literal.finditer(text):
                # Read the literal far enough to see which fields it carries.
                body = text[match.start() : match.start() + 900]
                hits = [field for field in FABRICATED_ROW_FIELDS if f"{field}:" in body]
                # One field could be a legitimate config list; two or more is a data table.
                if len(hits) >= 2:
                    line_number = text.count("\n", 0, match.start()) + 1
                    findings.append(
                        f"{relative(root, path)}:{line_number}: inline data table with fields "
                        + ", ".join(hits[:4])
                    )
    return findings


def check_mock_paths(root: Path) -> list[str]:
    findings = []
    for subdirectory in PRODUCTION_ROOTS + ["src/lib", "src-tauri/src", "python-sidecar/lmd_sidecar"]:
        for path in iter_files(root, subdirectory, (".ts", ".tsx", ".rs", ".py")):
            rel = relative(root, path)
            if is_test_path(path) or rel in DEMO_MODULES:
                continue
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if MOCK_PATH_PATTERN.search(line):
                    findings.append(f"{rel}:{line_number}: fixed mock file path")
    return findings


def check_rust_fixed_science(root: Path) -> list[str]:
    findings = []
    for path in iter_files(root, "src-tauri/src", (".rs",)):
        if is_test_path(path):
            continue
        text = path.read_text(encoding="utf-8")
        # Skip the test module of each file; fixtures there are legitimate.
        head = text.split("#[cfg(test)]", 1)[0]
        for line_number, line in enumerate(head.splitlines(), 1):
            if RUST_FIXED_SCIENCE.search(line):
                findings.append(
                    f"{relative(root, path)}:{line_number}: command returns a hard-coded scientific value"
                )
    return findings


def check_markers(root: Path) -> list[str]:
    findings = []
    targets = [root / "src-tauri" / "tauri.conf.json"]
    for subdirectory in PRODUCTION_ROOTS + ["src/lib", "src-tauri/src", "python-sidecar/lmd_sidecar"]:
        targets.extend(iter_files(root, subdirectory, (".ts", ".tsx", ".rs", ".py", ".json")))
    for path in targets:
        if not path.is_file():
            continue
        rel = relative(root, path)
        if is_test_path(path) or rel in DEMO_MODULES:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for marker in FORBIDDEN_MARKERS:
                if marker in line:
                    findings.append(f"{rel}:{line_number}: forbidden marker '{marker}'")
    return findings


CHECKS = [
    ("demo-module imports", check_demo_imports),
    ("buttons without behaviour", check_buttons_have_behaviour),
    ("fabricated inline data tables", check_no_fabricated_tables),
    ("fixed mock file paths", check_mock_paths),
    ("hard-coded scientific values", check_rust_fixed_science),
    ("forbidden markers", check_markers),
]


def parse_root(argv: list[str]) -> Path:
    """The tree to audit. Defaults to the repository this script lives in.

    An explicit root lets the audit's own tests run against a scratch copy, so a fixture never has
    to be written into — or deleted from — the production source tree.
    """
    if "--root" in argv:
        return Path(argv[argv.index("--root") + 1]).resolve()
    return DEFAULT_ROOT


def main(argv: list[str]) -> int:
    root = parse_root(argv)
    failed = False
    for label, check in CHECKS:
        findings = check(root)
        if findings:
            failed = True
            print(f"FAIL {label}:", file=sys.stderr)
            for finding in findings:
                print(f"  {finding}", file=sys.stderr)
        else:
            print(f"ok   {label}")
    if failed:
        print(
            "\nProduction placeholders found. Demo-only code belongs in an allow-listed module "
            "under src/lib.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
