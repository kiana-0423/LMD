"""Development must launch the current source with the selected Python environment."""

import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest


SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


@pytest.fixture
def prepare(monkeypatch):
    monkeypatch.syspath_prepend(str(SCRIPTS))
    return importlib.import_module("prepare_sidecar_dev")


def test_replacing_packaged_binary_refreshes_cargo_resource_timestamp(prepare, tmp_path, monkeypatch):
    source = tmp_path / "scripts"
    source.mkdir()
    launcher = source / "lmd-sidecar-dev.sh"
    launcher.write_text("#!/bin/sh\nexit 0\n")
    os.utime(launcher, (1, 1))
    destination = tmp_path / "binaries" / "lmd-sidecar-test"
    destination.parent.mkdir()
    destination.write_bytes(b"old packaged binary")
    os.utime(destination, (2, 2))
    monkeypatch.setattr(prepare, "SCRIPT_ROOT", source)

    prepare.install_launcher(destination)

    assert destination.read_bytes() == launcher.read_bytes()
    assert destination.stat().st_mtime > 2
    if os.name != "nt":
        assert os.access(destination, os.X_OK)


@pytest.mark.skipif(os.name == "nt", reason="Unix development shell launcher")
@pytest.mark.parametrize("root_environment", [True, False])
def test_launcher_uses_local_venvs_from_outside_repository(tmp_path, root_environment):
    repo = tmp_path / "project with spaces"
    package = repo / "python-sidecar" / "lmd_sidecar"
    package.mkdir(parents=True)
    (package / "main.py").write_text("")
    launcher = repo / "src-tauri" / "target" / "debug" / "lmd-sidecar"
    launcher.parent.mkdir(parents=True)
    shutil.copyfile(SCRIPTS / "lmd-sidecar-dev.sh", launcher)
    launcher.chmod(0o755)
    # Both environments exist when testing precedence. A fake interpreter only
    # answers the version probe and identifies itself on the final invocation.
    prefixes = [repo / "python-sidecar" / ".venv"]
    if root_environment:
        prefixes.append(repo / ".venv")
    for prefix in prefixes:
        executable = prefix / "bin" / "python3"
        executable.parent.mkdir(parents=True)
        executable.write_text('#!/bin/sh\nif [ "$1" = "-c" ]; then exit 0; fi\nprintf "%s\\n" "$0"\n')
        executable.chmod(0o755)
    environment = os.environ.copy()
    for key in ["LMD_PYTHON", "PYTHON", "CONDA_PREFIX", "VIRTUAL_ENV", "LMD_PYTHON_SIDECAR_DIR"]:
        environment.pop(key, None)
    result = subprocess.run([str(launcher), "health"], cwd=tmp_path, env=environment,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(prefixes[-1] / "bin" / "python3")


@pytest.mark.parametrize("stdout,code,detail", [
    (json.dumps({"ok": True, "data": {"mode": "unavailable", "missing": ["rdkit"]}}), 0, "rdkit"),
    ("not json", 0, "not json"),
    (json.dumps({"ok": True, "data": {"mode": "real"}}), 1, "failure"),
])
def test_preflight_rejects_broken_runtime(prepare, monkeypatch, stdout, code, detail):
    result = subprocess.CompletedProcess([], code, stdout, "failure" if code else "")
    monkeypatch.setattr(prepare.subprocess, "run", lambda *args, **kwargs: result)
    with pytest.raises(RuntimeError, match=detail):
        prepare.check_launcher(Path("unused-launcher"))


def test_preflight_accepts_real_runtime(prepare, monkeypatch):
    result = subprocess.CompletedProcess([], 0, json.dumps({
        "ok": True, "data": {"mode": "real", "python_version": "3.11.16"}
    }), "")
    monkeypatch.setattr(prepare.subprocess, "run", lambda *args, **kwargs: result)
    prepare.check_launcher(Path("unused-launcher"))
