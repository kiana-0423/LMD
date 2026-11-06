#!/usr/bin/env python3
"""Verify Windows executable architecture and, when requested, the GUI/console subsystem."""

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

PE_SUBSYSTEMS = {2: "windows", 3: "console"}


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


def read_pe_subsystem(path: Path) -> str:
    # Check the DOS and PE signatures before following offsets into an arbitrary file.
    read_pe_machine(path)
    with path.open("rb") as executable:
        executable.seek(0x3C)
        pe_offset = struct.unpack("<I", executable.read(4))[0]
        executable.seek(pe_offset + 20)  # SizeOfOptionalHeader in the COFF header.
        size_bytes = executable.read(2)
        if len(size_bytes) != 2:
            raise ValueError(f"{path} has a truncated COFF header")
        optional_size = struct.unpack("<H", size_bytes)[0]
        executable.seek(pe_offset + 24)
        optional_header = executable.read(optional_size)
    if optional_size < 70 or len(optional_header) != optional_size:
        raise ValueError(f"{path} has a missing or truncated PE optional header")
    magic = struct.unpack_from("<H", optional_header)[0]
    if magic not in (0x10B, 0x20B):
        raise ValueError(f"{path} has an unsupported PE optional header: 0x{magic:04x}")
    # Subsystem is at offset 68 in both PE32 and PE32+.
    subsystem = struct.unpack_from("<H", optional_header, 68)[0]
    return PE_SUBSYSTEMS.get(subsystem, f"unknown-0x{subsystem:04x}")


def verify_pe_subsystem(path: Path, expected: str) -> None:
    actual = read_pe_subsystem(path)
    if actual != expected:
        raise ValueError(f"{path} uses the {actual} subsystem, expected {expected}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect", choices=sorted(set(PE_MACHINES.values())), required=True)
    parser.add_argument("--subsystem", choices=sorted(PE_SUBSYSTEMS.values()))
    parser.add_argument("executables", nargs="+", type=Path)
    args = parser.parse_args()
    for executable in args.executables:
        verify_pe_machine(executable, args.expect)
        if args.subsystem:
            verify_pe_subsystem(executable, args.subsystem)
        print(f"ok   {executable}: {args.expect}")
        if args.subsystem:
            print(f"ok   {executable}: {args.subsystem} subsystem")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
