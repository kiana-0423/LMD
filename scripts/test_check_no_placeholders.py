#!/usr/bin/env python3
"""Regression tests for the production-placeholder audit.

Each fixture reproduces a defect that actually shipped and that an earlier, substring-only audit
did not catch. Every fixture runs inside its own temporary tree, so this test never writes into,
or deletes from, the production source directory — which also makes it safe to run alongside a
type-check or a build.

The last test proves that: it takes a checksum of every production source file before and after the
whole run and asserts nothing moved.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from check_no_placeholders import BUTTON_OPEN, is_dropdown_trigger

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "scripts" / "audit_fixtures"
AUDIT = ROOT / "scripts" / "check_no_placeholders.py"
I18N_AUDIT = ROOT / "scripts" / "audit-untranslated.mjs"

# Where a fixture lands inside the scratch tree: a production feature directory the audit scans.
FIXTURE_DIRECTORY = Path("src/features/molecules/components")

CASES = [
    ("handler_less_button.tsx.fixture", "AuditFixtureButton.tsx", "buttons without behaviour"),
    ("fabricated_table.tsx.fixture", "AuditFixtureTable.tsx", "fabricated inline data tables"),
    ("mock_import.tsx.fixture", "AuditFixtureImport.tsx", "demo-module imports"),
    ("mock_path.tsx.fixture", "AuditFixturePaths.tsx", "fixed mock file paths"),
    ("obsolete_phrase.ts.fixture", "AuditFixturePhrase.ts", "forbidden markers"),
]

# Directories the audit reads. A scratch tree holds these and nothing else.
SCANNED = [
    "src/features",
    "src/components",
    "src/layouts",
    "src/routes",
    "src/i18n",
    "src/lib",
    "src-tauri/src",
    "python-sidecar/lmd_sidecar",
]


# Translation fixtures, with every string the audit must name in each.
I18N_CASES = [
    (
        "hardcoded_string.tsx.fixture",
        "AuditFixtureHardcoded.tsx",
        ["Recalculate everything", "Descriptor Summary"],
    ),
    (
        "untranslated_shapes.tsx.fixture",
        "AuditFixtureShapes.tsx",
        [
            "Waiting for input",          # a state initializer
            "Working on it",              # a setter call
            "Nothing was selected",       # a thrown error
            "That did not work",          # a string passed through a helper
            "Fixture panel",              # a custom prop
            "No value recorded",          # a `||` fallback
            "Current status:",            # JSX text beside an expression
            "Run it",                     # plain JSX text
        ],
    ),
    (
        "untranslated_helper.ts.fixture",
        "AuditFixtureHelper.ts",
        ["A measurement cannot be negative.", "The measurement looks fine."],
    ),
    (
        "untranslated_returns.tsx.fixture",
        "AuditFixtureReturns.tsx",
        [
            "Not recorded yet",                    # a default parameter value
            "Waiting in the queue",                # a string returned from a function
            "No note was written for this row",    # a `??` fallback inside a return
            "Nothing to summarise",                # a string returned from an arrow body
        ],
    ),
]


def run_audit(root: Path, script: Path = AUDIT) -> subprocess.CompletedProcess[str]:
    """Runs one audit against a tree. The translation audit is a Node script; the rest are Python."""
    command = (
        ["node", str(script)] if script.suffix == ".mjs" else [sys.executable, str(script)]
    )
    return subprocess.run(
        [*command, "--root", str(root)],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )


def source_checksum() -> dict[str, str]:
    """A checksum of every file the audit reads, so a stray write shows up."""
    digests: dict[str, str] = {}
    for directory in SCANNED:
        base = ROOT / directory
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.is_file():
                digests[path.relative_to(ROOT).as_posix()] = hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
    return digests


def build_scratch_tree(scratch: Path) -> None:
    """Copies the scanned directories into a scratch tree, plus the config file the audit reads."""
    for directory in SCANNED:
        source = ROOT / directory
        if source.exists():
            shutil.copytree(source, scratch / directory)
    config = ROOT / "src-tauri" / "tauri.conf.json"
    if config.is_file():
        (scratch / "src-tauri").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(config, scratch / "src-tauri" / "tauri.conf.json")


def main() -> int:
    dropdown = '<Dropdown trigger={["click"]} menu={{ items: [{ onClick: run }] }}>'
    for source, expected in [
        (dropdown + '\n<Button loading={busy}>Actions</Button></Dropdown>', True),
        (dropdown + '<div><Button>Unrelated</Button></div></Dropdown>', False),
        (dropdown + '<span /> <Button>Unrelated</Button></Dropdown>', False),
        (dropdown + '</Dropdown><Button>Unrelated</Button>', False),
        ('<Dropdown trigger={["click"]} menu={{ items: [] }}><Button>Empty</Button></Dropdown>', False),
        ('<Button loading={busy}>No handler</Button>', False),
    ]:
        button = BUTTON_OPEN.search(source)
        assert button is not None
        assert is_dropdown_trigger(source, button) == expected, source
    print("ok   actionable dropdown triggers are recognised without exempting unrelated buttons")

    before = source_checksum()

    baseline = run_audit(ROOT)
    if baseline.returncode != 0:
        print("The audit must pass on a clean tree before the fixtures are meaningful.", file=sys.stderr)
        print(baseline.stderr, file=sys.stderr)
        return 1
    print("ok   clean tree passes the audit")

    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix="lmd-audit-") as directory:
        scratch = Path(directory) / "tree"
        build_scratch_tree(scratch)

        clean = run_audit(scratch)
        if clean.returncode != 0:
            failures.append(f"the scratch copy of the tree does not pass:\n{clean.stderr}")
        else:
            print("ok   the scratch copy passes too, so a failure below is the fixture's doing")

        for fixture, filename, expected_check in CASES:
            destination = scratch / FIXTURE_DIRECTORY / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                failures.append(f"{filename} already exists in the scratch tree")
                continue
            shutil.copyfile(FIXTURES / fixture, destination)
            try:
                result = run_audit(scratch)
                combined = result.stdout + result.stderr
                if result.returncode == 0:
                    failures.append(f"{fixture}: the audit did not fail")
                elif expected_check not in combined:
                    failures.append(
                        f"{fixture}: expected the '{expected_check}' check to fail, got:\n{combined}"
                    )
                else:
                    print(f"ok   {fixture} is caught by '{expected_check}'")
            finally:
                destination.unlink(missing_ok=True)

        # The translation audit is checked the same way: a fixture that types its label instead of
        # looking it up must fail, or the language switch would quietly leave it in English.
        i18n_clean = run_audit(scratch, I18N_AUDIT)
        if i18n_clean.returncode != 0:
            failures.append(f"the scratch copy has untranslated strings:\n{i18n_clean.stderr}")
        else:
            print("ok   the scratch copy has no hard-coded user-visible strings")

        # Each translation fixture names the strings the audit has to find in it. A shape the
        # audit stops seeing shows up here as a missing string, not as a silent pass.
        for fixture, filename, expected in I18N_CASES:
            destination = scratch / FIXTURE_DIRECTORY / filename
            shutil.copyfile(FIXTURES / fixture, destination)
            try:
                result = run_audit(scratch, I18N_AUDIT)
                combined = result.stdout + result.stderr
                if result.returncode == 0:
                    failures.append(f"{fixture}: the translation audit did not fail")
                    continue
                missed = [text for text in expected if text not in combined]
                if missed:
                    failures.append(
                        f"{fixture}: the audit did not report {missed}:\n{combined}"
                    )
                else:
                    print(f"ok   {fixture}: all {len(expected)} shape(s) are caught")
            finally:
                destination.unlink(missing_ok=True)

    after = source_checksum()
    if before != after:
        changed = sorted(
            set(before) ^ set(after) | {key for key in before if after.get(key) != before[key]}
        )
        failures.append("the audit's own tests modified production sources: " + ", ".join(changed))
    else:
        print(f"ok   all {len(before)} production source files are byte-identical afterwards")

    if failures:
        print("\nFAILURES:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    print(f"\nAll {len(CASES) + len(I18N_CASES)} previously missed defects are now detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
