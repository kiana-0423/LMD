"""Conservative normalization of single-record MOL2 input before RDKit parsing."""

from __future__ import annotations

import math


def prepare_mol2(text: str) -> tuple[str, list[str], list[str]]:
    # RDKit may drop the final bond when its line has no terminator. In particular,
    # Materials Studio ends the file at BOND instead of adding a SUBSTRUCTURE section.
    lines = text.removeprefix("\ufeff").splitlines()
    sections: dict[str, list[tuple[int, list[str]]]] = {}
    section = ""
    for index, line in enumerate(lines):
        if line.strip().startswith("@<TRIPOS>"):
            section = line.strip()[9:]
            if section in sections:
                raise ValueError("MOL2 import requires one molecule and no repeated sections. Split multi-molecule files before importing.")
            sections[section] = []
            lines[index] = line.strip()
        elif section and line.strip() and not line.lstrip().startswith("#"):
            sections[section].append((index, line.split()))
    if "MOLECULE" not in sections:
        raise ValueError("MOL2 is missing its @<TRIPOS>MOLECULE section.")

    atom_rows = sections.get("ATOM", [])
    bond_rows = sections.get("BOND", [])
    _validate_records(sections, atom_rows, bond_rows)
    normalized_types = _normalize_oxygen_types(atom_rows, bond_rows)
    inferred: list[str] = []
    if any(len(row) >= 4 and row[3] == "un" for _, row in bond_rows):
        inferred = _infer_six_rings(atom_rows, bond_rows)
        for index, row in bond_rows:
            if row[0] in inferred:
                row[3] = "ar"
    # Reader compatibility is handled independently of chemistry. Normalize record
    # IDs (including sparse or reordered IDs), remove comments/blank record lines,
    # and omit optional sections the molecular graph parser does not need.
    atom_ids = {row[0]: str(index) for index, (_, row) in enumerate(atom_rows, 1)}
    normalized = ["@<TRIPOS>MOLECULE"]
    normalized.extend(" ".join(row) for _, row in sections["MOLECULE"][:4])
    normalized.extend(["", "@<TRIPOS>ATOM"])
    for _, row in atom_rows:
        normalized.append(" ".join([atom_ids[row[0]], *row[1:]]))
    normalized.append("@<TRIPOS>BOND")
    for index, (_, row) in enumerate(bond_rows, 1):
        normalized.append(" ".join([str(index), atom_ids[row[1]], atom_ids[row[2]], *row[3:]]))
    return "\n".join(normalized) + "\n", inferred, normalized_types


def _validate_records(sections, atom_rows, bond_rows) -> None:
    """Check every file before any inference or RDKit call, with original row IDs."""
    header = sections["MOLECULE"]
    try:
        if len(header) < 4:
            raise ValueError("missing header fields")
        atom_count, bond_count = map(int, header[1][1][:2])
    except (IndexError, ValueError) as exc:
        raise ValueError("MOL2 has an invalid molecule header or atom/bond counts line.") from exc
    if atom_count < 1 or bond_count < 0:
        raise ValueError("MOL2 must contain at least one atom and a nonnegative bond count.")
    if atom_count != len(atom_rows) or bond_count != len(bond_rows):
        raise ValueError(
            f"MOL2 atom/bond counts do not match the records: header {atom_count}/{bond_count}, "
            f"actual {len(atom_rows)}/{len(bond_rows)}. Re-export the complete structure."
        )
    atoms: set[str] = set()
    for line, row in atom_rows:
        if len(row) < 6:
            raise ValueError(f"MOL2 line {line + 1}: incomplete atom record (six fields required).")
        atom_id = row[0]
        try:
            number = int(atom_id)
            coordinates = [float(value) for value in row[2:5]]
        except ValueError as exc:
            raise ValueError(f"MOL2 line {line + 1}: atom {atom_id} has an invalid ID or coordinate.") from exc
        if number < 1 or atom_id != str(number) or atom_id in atoms:
            raise ValueError(f"MOL2 line {line + 1}: invalid or duplicate atom ID {atom_id}.")
        if not all(math.isfinite(value) for value in coordinates):
            raise ValueError(f"MOL2 line {line + 1}: atom {atom_id} has a non-finite coordinate.")
        atoms.add(atom_id)
    bonds: set[str] = set()
    pairs: set[frozenset[str]] = set()
    for line, row in bond_rows:
        if len(row) < 4:
            raise ValueError(f"MOL2 line {line + 1}: incomplete bond record (four fields required).")
        bond_id, first, second, kind = row[:4]
        if bond_id in bonds:
            raise ValueError(f"MOL2 line {line + 1}: duplicate bond ID {bond_id}.")
        if first not in atoms or second not in atoms:
            raise ValueError(f"MOL2 line {line + 1}: bond {bond_id} references missing atom {first} or {second}.")
        pair = frozenset((first, second))
        if first == second or pair in pairs:
            raise ValueError(f"MOL2 line {line + 1}: bond {bond_id} duplicates an atom pair or connects an atom to itself.")
        if kind not in {"1", "2", "3", "ar", "am", "un"}:
            raise ValueError(
                f"MOL2 line {line + 1}: bond {bond_id} has unsupported type {kind!r}. "
                "Export explicit single/double/triple/aromatic bond orders."
            )
        bonds.add(bond_id)
        pairs.add(pair)


def _normalize_oxygen_types(atom_rows, bond_rows) -> list[str]:
    """Reconcile O.co2 labels only where explicit bonds specify neutral oxygen.

    O.co2 is sometimes emitted for every ester/phosphate oxygen. Preserve actual
    terminal carboxylate pairs (including their charge/resonance interpretation).
    Partial charges in MOL2 are not used as formal charges.
    """
    atoms = {row[0]: row for _, row in atom_rows}
    neighbours: dict[str, list[tuple[str, str]]] = {atom: [] for atom in atoms}
    for _, row in bond_rows:
        _, first, second, kind = row[:4]
        neighbours[first].append((second, kind))
        neighbours[second].append((first, kind))
    changes = []
    for atom, row in atoms.items():
        if row[5] != "O.co2":
            continue
        edges = neighbours[atom]
        replacement = None
        if len(edges) == 2 and all(kind == "1" for _, kind in edges):
            replacement = "O.3"
        elif len(edges) == 1 and edges[0][1] == "2":
            center = edges[0][0]
            carboxylate = atoms[center][5].startswith("C.") and any(
                other != atom and atoms[other][5] == "O.co2"
                and len(neighbours[other]) == 1 and kind == "1"
                for other, kind in neighbours[center]
            )
            if not carboxylate:
                replacement = "O.2"
        if replacement:
            changes.append(f"{atom}:O.co2->{replacement}")
            row[5] = replacement
    return changes


def _infer_six_rings(atom_rows, bond_rows) -> list[str]:
    """Infer isolated six-member sp2 C / pyridine-like N cycles.

    Carbon must have one explicit external single bond; nitrogen must have no
    external bond or hydrogen. Fused/incomplete cycles and other types are refused.
    No geometry or filename is used to guess bonds; RDKit must still sanitize.
    """
    atoms = {row[0]: row[5] for _, row in atom_rows}
    neighbours: dict[str, list[tuple[str, str]]] = {atom: [] for atom in atoms}
    unknown: dict[str, set[str]] = {}
    for _, row in bond_rows:
        _, first, second, kind = row[:4]
        neighbours[first].append((second, kind))
        neighbours[second].append((first, kind))
        if kind == "un":
            unknown.setdefault(first, set()).add(second)
            unknown.setdefault(second, set()).add(first)
    ids = [row[0] for _, row in bond_rows if row[3] == "un"]
    error = (
        "MOL2 contains unknown bond orders ('un') outside fully specified six-membered "
        "sp2 carbon/pyridine-like nitrogen rings. Export explicit single/double/aromatic "
        f"bond orders; these bonds cannot be inferred safely (bond IDs: {', '.join(ids)})."
    )
    remaining = set(unknown)
    while remaining:
        ring: set[str] = set()
        pending = [next(iter(remaining))]
        while pending:
            atom = pending.pop()
            if atom not in ring:
                ring.add(atom)
                pending.extend(unknown[atom] - ring)
        if len(ring) != 6 or any(len(unknown[atom]) != 2 for atom in ring):
            raise ValueError(error)
        for atom in ring:
            outside = [(other, kind) for other, kind in neighbours[atom] if other not in ring]
            carbon = (atoms[atom] in {"C.2", "C.ar"} and len(neighbours[atom]) == 3
                      and len(outside) == 1 and outside[0][1] == "1")
            nitrogen = atoms[atom] in {"N.2", "N.ar"} and len(neighbours[atom]) == 2
            if not (carbon or nitrogen):
                raise ValueError(error)
        remaining -= ring
    return ids
