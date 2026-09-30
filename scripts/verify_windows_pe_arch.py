#!/usr/bin/env python3
"""Verify that Windows executables contain the machine type their filename promises."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


PE_MACHINES = {
    0x014C: "i686",
    0x8664: "x86_64",
    0xAA64: "aarch64",
}

TARGET_MACHINES = {
    "i686-pc-windows-msvc": "i686",
    "x86_64-pc-windows-msvc": "x86_64",
    "aarch64-pc-windows-msvc": "aarch64",
}


def read_pe_machine(path: Path) -> str:
    with path.open("rb") as executable:
        if executable.read(2) != b"MZ":
            raise ValueError(f"{path} is not a PE executable (missing MZ header)")
        executable.seek(0x3C)
        offset_bytes = executable.read(4)
        if len(offset_bytes) != 4:
            raise ValueError(f"{path} has a truncated DOS header")
        pe_offset = struct.unpack("<I", offset_bytes)[0]
        executable.seek(pe_offset)
        if executable.read(4) != b"PE\0\0":
            raise ValueError(f"{path} has no PE signature at offset {pe_offset}")
        machine_bytes = executable.read(2)
        if len(machine_bytes) != 2:
            raise ValueError(f"{path} has a truncated COFF header")
    machine_id = struct.unpack("<H", machine_bytes)[0]
    return PE_MACHINES.get(machine_id, f"unknown-0x{machine_id:04x}")


def expected_machine_for_target(target: str) -> str:
    try:
        return TARGET_MACHINES[target]
    except KeyError as exc:
        raise ValueError(f"No Windows PE machine mapping for target {target}") from exc


def verify_pe_machine(path: Path, expected: str) -> None:
    actual = read_pe_machine(path)
    if actual != expected:
        raise ValueError(f"{path} is {actual}, expected {expected}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect", choices=sorted(set(PE_MACHINES.values())), required=True)
    parser.add_argument("executables", nargs="+", type=Path)
    args = parser.parse_args()
    for executable in args.executables:
        verify_pe_machine(executable, args.expect)
        print(f"ok   {executable}: {args.expect}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
