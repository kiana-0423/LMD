"""Seed-derived analogues without a predefined class template.

Cut one BRICS bond at a time, keep both typed halves, and join compatible pairs once.
This exchanges seed fragments; it does not claim a fixed core, a chemical class, or synthesis
feasibility. Pair sampling and work limits are explicit, and only contributing seeds are recorded.
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass
from typing import Any

from .design_templates import Finding, METALS
from .rdkit_service import require_rdkit

GENERATOR_VERSION = "seed-brics-exchange-1.0.0"
ELEMENTS = ("C", "H", "B", "N", "O", "F", "Si", "P", "S", "Cl", "Br")
MAX_FRAGMENTS = 200
MAX_PAIRS = 2000
MAX_SEED_ATOMS = 120
MAX_CUTS_PER_SEED = 24


@dataclass(frozen=True)
class MoleculeConstraints:
    permitted_elements: tuple[str, ...] = ELEMENTS
    min_heavy_atoms: int = 2
    max_heavy_atoms: int = 60
    max_branch_points: int = 10

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "MoleculeConstraints":
        payload = payload or {}
        elements = tuple(payload.get("permitted_elements", ELEMENTS))
        if not elements or set(elements) - set(ELEMENTS):
            raise ValueError(f"Candidate elements must be selected from {', '.join(ELEMENTS)}.")
        low = int(payload.get("min_heavy_atoms", 2))
        high = int(payload.get("max_heavy_atoms", 60))
        branches = int(payload.get("max_branch_points", 10))
        if not 1 <= low <= high <= MAX_SEED_ATOMS or not 0 <= branches <= MAX_SEED_ATOMS:
            raise ValueError("Candidate bounds require 1 <= min <= max <= 120 heavy atoms and 0 <= branch points <= 120.")
        return cls(tuple(sorted(set(elements) | {"C", "H"})), low, high, branches)

    def to_json(self) -> dict[str, Any]:
        return {
            "permitted_elements": list(self.permitted_elements),
            "min_heavy_atoms": self.min_heavy_atoms,
            "max_heavy_atoms": self.max_heavy_atoms,
            "max_branch_points": self.max_branch_points,
        }


def validate_candidate(mol, constraints: MoleculeConstraints) -> list[Finding]:
    Chem = require_rdkit()["Chem"]
    if mol is None or mol.GetNumAtoms() == 0:
        return [Finding("sanitized", False, "The structure is empty or unreadable.")]
    try:
        Chem.SanitizeMol(mol)
    except Exception as exc:
        return [Finding("sanitized", False, str(exc))]
    atoms = list(mol.GetAtoms())
    elements = {atom.GetSymbol() for atom in atoms if atom.GetAtomicNum() > 0}
    branches = sum(atom.GetAtomicNum() == 6 and sum(n.GetAtomicNum() > 1 for n in atom.GetNeighbors()) > 2 for atom in atoms)
    return [
        Finding("sanitized", True, "RDKit sanitisation passed."),
        Finding("single_fragment", len(Chem.GetMolFrags(mol)) == 1, "One connected molecule is required."),
        Finding("complete", all(atom.GetAtomicNum() > 0 for atom in atoms), "No unfilled attachment positions are allowed."),
        Finding("neutral", all(atom.GetFormalCharge() == 0 for atom in atoms), "Charged atoms and salts are excluded."),
        Finding("no_metals", not (elements & METALS), "Metal-containing structures are excluded."),
        Finding("allowed_elements", elements <= set(constraints.permitted_elements), "Whole-molecule elements must be permitted."),
        Finding("heavy_atom_range", constraints.min_heavy_atoms <= mol.GetNumHeavyAtoms() <= constraints.max_heavy_atoms, "Whole-molecule heavy-atom limits apply."),
        Finding("branch_points", branches <= constraints.max_branch_points, "Whole-molecule carbon branch-point limit applies."),
    ]


def generate_seed_candidates(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    from rdkit.Chem import BRICS
    from .design_service import _identifiers, _svg

    Chem = require_rdkit()["Chem"]
    seeds = list(payload.get("seeds") or [])
    if not 1 <= len(seeds) <= 25:
        raise ValueError("Without a template, supply between 1 and 25 seed molecules.")
    limit = int(payload.get("max_candidates", 100))
    if not 1 <= limit <= 500:
        raise ValueError("max_candidates must be between 1 and 500.")
    random_seed = payload.get("random_seed")
    random_seed = int(random_seed) if random_seed is not None else 42
    rng = random.Random(random_seed)
    constraints = MoleculeConstraints.from_payload(payload.get("candidate_constraints"))
    pool: dict[str, dict[str, Any]] = {}
    reports: list[dict[str, Any]] = []
    seed_keys: set[str] = set()
    seed_limits = MoleculeConstraints(ELEMENTS, 1, MAX_SEED_ATOMS, MAX_SEED_ATOMS)
    for index, seed in enumerate(seeds):
        seed_id = str(seed.get("id") or f"seed-{index + 1}")
        mol = Chem.MolFromSmiles(str(seed.get("smiles") or ""))
        findings = validate_candidate(mol, seed_limits)
        report = {"id": seed_id, "smiles": str(seed.get("smiles") or ""), "accepted": 0, "brics_fragments": 0, "error": ""}
        if not all(finding.ok for finding in findings):
            report["error"] = "; ".join(finding.detail for finding in findings if not finding.ok)
            reports.append(report)
            continue
        seed_keys.add(_identifiers(mol)["inchi_key"])
        cuts = list(BRICS.FindBRICSBonds(mol))
        if len(cuts) > MAX_CUTS_PER_SEED:
            raise ValueError(f"Seed {seed_id} has more than {MAX_CUTS_PER_SEED} BRICS bonds; choose a smaller seed.")
        for cut in cuts:
            pieces = Chem.GetMolFrags(BRICS.BreakBRICSBonds(mol, bonds=[cut]), asMols=True)
            for piece in pieces:
                if sum(atom.GetAtomicNum() == 0 for atom in piece.GetAtoms()) != 1:
                    continue
                smiles = Chem.MolToSmiles(piece, canonical=True)
                # Isotopes encode BRICS compatibility and must not be stripped.
                report["brics_fragments"] += 1
                if smiles not in pool:
                    pool[smiles] = {"mol": piece, "smiles": smiles, "seed_id": seed_id}
                    report["accepted"] += 1
        if not cuts:
            report["error"] = "No BRICS-cleavable bond; this seed cannot supply exchange fragments."
        reports.append(report)
    if len(pool) > MAX_FRAGMENTS:
        raise ValueError(f"More than {MAX_FRAGMENTS} fragments were collected; narrow the seed selection.")

    fragments = [pool[key] for key in sorted(pool)]
    pairs = list(itertools.combinations_with_replacement(range(len(fragments)), 2))
    pair_count = len(pairs)
    # Random order is local to this request, including when the complete pair space is small.
    pairs = rng.sample(pairs, min(len(pairs), MAX_PAIRS))
    candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()
    duplicates = 0
    seed_matches = 0
    attempts = 0
    products = 0
    for left_index, right_index in pairs:
        attempts += 1
        left, right = fragments[left_index], fragments[right_index]
        # One pair, one joining step: intermediate search cannot grow recursively.
        for mol in BRICS.BRICSBuild([right["mol"]], seeds=[left["mol"]], maxDepth=0, scrambleReagents=False):
            products += 1
            findings = validate_candidate(mol, constraints)
            if not all(finding.ok for finding in findings):
                rejected.append({"substituents": [left["smiles"], right["smiles"]], "findings": [finding.to_json() for finding in findings]})
                continue
            identifiers = _identifiers(mol)
            key = identifiers["inchi_key"]
            if key in seed_keys:
                seed_matches += 1
                continue
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            candidates.append({
                **identifiers,
                "template_id": "",
                "template_family": "",
                "chemical_classes": [],
                "substituents": [{
                    "position": position,
                    "smiles": fragment["smiles"],
                    "name": fragment["smiles"],
                    "type": "brics_fragment",
                    "elements": sorted({atom.GetSymbol() for atom in fragment["mol"].GetAtoms() if atom.GetAtomicNum() > 0}),
                    "source": "brics",
                    "source_id": fragment["seed_id"],
                } for position, fragment in enumerate((left, right), start=1)],
                "seed_ids": sorted({left["seed_id"], right["seed_id"]}),
                "generator_version": GENERATOR_VERSION,
                "validation": {"status": "valid", "scope": "general_structure", "findings": [finding.to_json() for finding in findings]},
                "svg": _svg(mol),
            })
            if len(candidates) >= limit:
                break
        if len(candidates) >= limit:
            break

    warnings = []
    if attempts < pair_count:
        warnings.append(f"Examined {attempts} of {pair_count} fragment pairs; the candidate or work limit stopped the search.")
    if not candidates:
        warnings.append("No changed structure passed the constraints. Choose seeds with compatible BRICS fragments or adjust whole-molecule limits.")
    return {
        "template": None,
        "generator_version": GENERATOR_VERSION,
        "parameters": {
            "generation_method": "seed_brics_exchange",
            "candidate_constraints": constraints.to_json(),
            "random_seed": random_seed,
            "max_candidates": limit,
            "seed_count": len(seeds),
            "fragment_pair_count": pair_count,
            "attempted_pairs": attempts,
            "max_pair_attempts": MAX_PAIRS,
            "brics_max_depth": 0,
            "unchanged_seed_products": seed_matches,
        },
        "random_seed": random_seed,
        "substituent_count": len(fragments),
        "substituents": [{"position": index, "smiles": f["smiles"], "name": f["smiles"], "type": "brics_fragment", "elements": sorted({atom.GetSymbol() for atom in f["mol"].GetAtoms() if atom.GetAtomicNum() > 0}), "source_id": f["seed_id"], "source": "brics"} for index, f in enumerate(fragments, start=1)],
        "rejected_substituents": [],
        "seed_reports": reports,
        # Pair counts are not the size of the complete molecular search space.
        "enumerated_total": None,
        "proposed_count": products,
        "duplicate_count": duplicates,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "rejected_structures": rejected,
        "mode": "real",
    }, warnings
