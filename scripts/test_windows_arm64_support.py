#!/usr/bin/env python3
"""Regression tests for native Windows ARM64 build guards."""

from __future__ import annotations

import struct
import tempfile
from pathlib import Path

from build_sidecar import target_triple
from check_windows_arm64_wheels import PURE_PYTHON_SDISTS, compatible_wheels, locked_requirements
from verify_windows_pe_arch import read_pe_machine, verify_pe_machine


ROOT = Path(__file__).resolve().parents[1]


def fake_pe(path: Path, machine: int) -> None:
    header = bytearray(256)
    header[:2] = b"MZ"
    struct.pack_into("<I", header, 0x3C, 0x80)
    header[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<H", header, 0x84, machine)
    path.write_bytes(header)


def main() -> int:
    assert target_triple("Windows", "ARM64") == "aarch64-pc-windows-msvc"
    assert target_triple("Windows", "aarch64") == "aarch64-pc-windows-msvc"
    assert target_triple("Windows", "AMD64") == "x86_64-pc-windows-msvc"
    print("ok   Windows native architectures map to unambiguous Tauri targets")

    requirements = {requirement.name.lower() for requirement in locked_requirements()}
    assert "colorama" in requirements
    assert "macholib" not in requirements
    assert PURE_PYTHON_SDISTS == {"mordred"}
    print("ok   Windows ARM64 marker evaluation includes Windows-only requirements")

    files = [
        {"filename": "example-1.0-cp312-cp312-win_arm64.whl"},
        {"filename": "example-1.0-cp312-cp312-win_amd64.whl"},
        {"filename": "example-1.0-py3-none-any.whl"},
        {"filename": "example-1.0.tar.gz"},
    ]
    compatible = compatible_wheels(files, (3, 12))
    assert compatible == [
        "example-1.0-cp312-cp312-win_arm64.whl",
        "example-1.0-py3-none-any.whl",
    ]
    print("ok   wheel audit accepts ARM64 and pure Python artifacts but rejects AMD64")

    with tempfile.TemporaryDirectory(prefix="lmd-pe-test-") as directory:
        executable = Path(directory) / "sidecar.exe"
        fake_pe(executable, 0xAA64)
        assert read_pe_machine(executable) == "aarch64"
        verify_pe_machine(executable, "aarch64")
        try:
            verify_pe_machine(executable, "x86_64")
        except ValueError as exc:
            assert "expected x86_64" in str(exc)
        else:
            raise AssertionError("ARM64 executable was accepted as x86_64")
    print("ok   PE verification rejects a mislabeled Windows sidecar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
