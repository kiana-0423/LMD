"""Guards that the packaged sidecar contains everything its commands import.

These are static checks, not runtime ones: they read the source and the PyInstaller spec. That is
deliberate. A runtime check can only be made on a machine where the dependency is installed, which
is precisely the machine that cannot tell you whether the *bundle* has it. Reading the spec catches
the regression that shipped — scikit-learn and SciPy listed under `excludes` while ml_service
imported both — on any machine, in a second.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

from lmd_sidecar.main import REQUIRED_DEPENDENCIES, command_handlers, health_status

PACKAGE_ROOT = Path(__file__).resolve().parents[1] / "lmd_sidecar"
SPEC_PATH = Path(__file__).resolve().parents[1] / "lmd-sidecar.spec"

# Modules the interpreter always provides, so they never need bundling.
STANDARD_LIBRARY = set(sys.stdlib_module_names) | {"lmd_sidecar", "__future__"}


def imported_top_level_modules() -> set[str]:
    """Every top-level module name imported anywhere in the package, including inside functions."""
    names: set[str] = set()
    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return {name for name in names if name not in STANDARD_LIBRARY}


def spec_excludes() -> list[str]:
    """The `excludes` list from the PyInstaller spec, read as source rather than executed."""
    tree = ast.parse(SPEC_PATH.read_text(encoding="utf-8"), filename=str(SPEC_PATH))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Analysis":
            for keyword in node.keywords:
                if keyword.arg == "excludes":
                    return [element.value for element in keyword.value.elts]
    raise AssertionError("The spec does not call Analysis(excludes=[...]).")


def test_health_reports_every_third_party_dependency():
    """A dependency a command imports but health never mentions is one nobody can be warned about."""
    reported = {module for module, _, _ in REQUIRED_DEPENDENCIES}
    imported = imported_top_level_modules()
    assert imported <= reported, (
        f"These modules are imported but absent from REQUIRED_DEPENDENCIES: {sorted(imported - reported)}"
    )


def test_no_runtime_dependency_is_excluded_from_the_bundle():
    """The regression this file exists for: excluding a package a command imports.

    An excluded package is not a smaller bundle with a missing extra. It is a command that raises
    ImportError the first time a user asks for it, in a build that reported itself healthy.
    """
    excluded = spec_excludes()
    for module, _, commands in REQUIRED_DEPENDENCIES:
        assert module not in excluded, (
            f"{module} is excluded from the PyInstaller bundle, but {', '.join(commands)} import it."
        )


def test_every_exclusion_is_a_submodule_or_an_uninstalled_package():
    """An exclusion must name test code, a legacy toolkit, or something not installed at all.

    Excluding a top-level runtime package is what broke the model commands; excluding
    `pandas.tests` is fine, because no command reaches it.
    """
    installed_runtime = {module for module, _, _ in REQUIRED_DEPENDENCIES}
    for exclusion in spec_excludes():
        root = exclusion.split(".")[0]
        assert root not in installed_runtime or "." in exclusion, (
            f"{exclusion} excludes the whole of {root}, which production commands import."
        )


def test_every_command_that_needs_a_dependency_declares_it():
    """Each command named in the dependency table must actually exist."""
    known = set(command_handlers())
    for module, _, commands in REQUIRED_DEPENDENCIES:
        unknown = [command for command in commands if command not in known]
        assert not unknown, f"{module} lists commands that do not exist: {unknown}"


def test_health_is_unavailable_when_any_dependency_is_missing(monkeypatch):
    """`real` must mean every command works, not that the first two do."""
    import lmd_sidecar.main as main

    def probe(module: str, distribution: str):
        if module == "sklearn":
            return {"available": False, "version": None, "error": "ModuleNotFoundError: sklearn"}
        return {"available": True, "version": "1.0"}

    monkeypatch.setattr(main, "_probe", probe)
    data, warnings = health_status()
    assert data["mode"] == "unavailable"
    assert data["missing"] == ["sklearn"]
    assert "train-model" in data["unavailable_commands"]
    assert warnings and "sklearn" in warnings[0]


def test_health_is_real_only_when_everything_imports(monkeypatch):
    import lmd_sidecar.main as main

    monkeypatch.setattr(main, "_probe", lambda module, distribution: {"available": True, "version": "1.0"})
    data, warnings = health_status()
    assert data["mode"] == "real"
    assert data["missing"] == []
    assert warnings == []


@pytest.mark.parametrize("module", ["sklearn", "scipy", "joblib", "openpyxl"])
def test_model_and_import_dependencies_are_declared(module):
    """The four that were missing or unmentioned before, named individually so a failure is legible."""
    assert module in {name for name, _, _ in REQUIRED_DEPENDENCIES}
