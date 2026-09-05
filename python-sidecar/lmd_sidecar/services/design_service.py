"""Candidate generation with optional class templates.

With a template, the generator enumerates structures inside its chemical class. A request names
a template, a set of substituent sources, and explicit limits; the result is every complete
structure that survives the template's validation rules, canonicalised and deduplicated, with the
provenance of each — the template, the substituents and where each came from, the seed molecules
involved, the generator version, the parameters, and the random seed used when the combinatorial
space had to be sampled.

What this deliberately does not do:

  * It never claims a candidate is new. The sidecar cannot see the workspace; the Rust layer
    matches candidates against stored molecules, and absence from a workspace is not novelty.
  * It never attaches a performance value or a function. A request may be *for* an antiwear
    additive, and that intent is recorded with the request, but a generated structure has no
    measured property until somebody measures one.
  * It never uses a learned generator. In template mode, BRICS supplies substituents without
    modifying the core. Without a template, seed_design_service exchanges compatible BRICS
    halves and applies whole-molecule rules without imposing a chemical class.

The graph-based optimisation extension point is `CandidateSource`: a later genetic operator that
proposes substituent sets would implement it and hand its proposals to the same assembly,
validation and deduplication below, so it could not produce an off-template structure either.
"""

from __future__ import annotations

import itertools
import math
import random
from dataclasses import dataclass, field
from typing import Any, Protocol

from .design_templates import (
    CURATED_SUBSTITUENTS,
    GENERATOR_VERSION,
    TEMPLATES,
    Finding,
    Substituent,
    SubstituentConstraints,
    Template,
    attach,
    check_substituent,
    classify_phosphate,
    core_molecule,
    describe_substituent,
    extract_substituents,
    is_phosphate_ester,
    parse_substituent_smiles,
    template_catalogue,
    validate_phosphate_candidate,
)
from .rdkit_service import require_rdkit

# Hard ceilings, independent of what a request asks for. A desktop application that enumerates a
# few hundred thousand structures in one sidecar call is a frozen window, not a feature.
MAX_CANDIDATES = 500
MAX_SEEDS = 25
MAX_SUBSTITUENTS = 200
MAX_ENUMERATION = 250_000

SUBSTITUENT_SOURCES: tuple[str, ...] = ("curated", "seed_substituents", "brics")


class CandidateSource(Protocol):
    """Anything that proposes substituent sets for a template.

    The combinatorial enumerator below is the one implementation shipped. A graph-based genetic
    optimiser would be a second: it proposes, this module assembles and validates. Proposals are
    tuples of substituents, one per attachment position, in position order.
    """

    def propose(
        self, template: Template, substituents: list[Substituent], limit: int, rng: random.Random
    ) -> tuple[list[tuple[Substituent, ...]], int]:
        """Returns the proposals and the size of the space they were drawn from."""


class CombinatorialSource:
    """Every combination of substituents over the template's equivalent positions.

    The positions of a phosphate ester are chemically equivalent, so (R1, R2) and (R2, R1) are one
    structure; combinations with replacement enumerate each once. `identical_only` restricts the
    space to symmetric esters — one substituent on every position.
    """

    def __init__(self, identical_only: bool) -> None:
        self.identical_only = identical_only

    def propose(
        self, template: Template, substituents: list[Substituent], limit: int, rng: random.Random
    ) -> tuple[list[tuple[Substituent, ...]], int]:
        count = len(substituents)
        if count == 0:
            return [], 0
        if self.identical_only:
            total = count
        else:
            total = math.comb(count + template.degree - 1, template.degree)
        if total > MAX_ENUMERATION:
            raise ValueError(
                f"The request enumerates {total} structures, above the {MAX_ENUMERATION} this "
                "generator will consider. Narrow the substituent list or the size limits."
            )
        if self.identical_only:
            combos: list[tuple[Substituent, ...]] = [
                tuple([item] * template.degree) for item in substituents
            ]
        else:
            combos = list(itertools.combinations_with_replacement(substituents, template.degree))
        if len(combos) > limit:
            # A deterministic sample: the same request with the same seed produces the same
            # candidates, and the seed is recorded with them.
            combos = rng.sample(combos, limit)
        return combos, total


@dataclass
class GenerationRequest:
    template: Template
    constraints: SubstituentConstraints
    sources: tuple[str, ...]
    curated_ids: tuple[str, ...] | None
    identical_only: bool
    max_candidates: int
    random_seed: int
    seeds: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "GenerationRequest":
        template_id = str(payload.get("template_id") or "")
        template = TEMPLATES.get(template_id)
        if template is None:
            raise ValueError(
                f"Unknown template '{template_id}'. Available templates: {', '.join(TEMPLATES)}."
            )
        constraints = SubstituentConstraints.from_payload(payload.get("constraints") or {})
        sources = tuple(str(item) for item in (payload.get("substituent_sources") or ("curated",)))
        unknown = [item for item in sources if item not in SUBSTITUENT_SOURCES]
        if unknown:
            raise ValueError(
                f"Substituent sources must be chosen from {', '.join(SUBSTITUENT_SOURCES)}; got {', '.join(unknown)}."
            )
        curated = payload.get("curated_substituent_ids")
        curated_ids = tuple(str(item) for item in curated) if curated is not None else None
        max_candidates = int(payload.get("max_candidates") or 100)
        if max_candidates < 1 or max_candidates > MAX_CANDIDATES:
            raise ValueError(f"max_candidates must be between 1 and {MAX_CANDIDATES}.")
        seeds = list(payload.get("seeds") or [])
        if len(seeds) > MAX_SEEDS:
            raise ValueError(f"At most {MAX_SEEDS} seed molecules may be supplied; got {len(seeds)}.")
        random_seed = payload.get("random_seed")
        random_seed = int(random_seed) if random_seed is not None else 42
        return cls(
            template=template,
            constraints=constraints,
            sources=sources,
            curated_ids=curated_ids,
            identical_only=bool(payload.get("identical_substituents", False)),
            max_candidates=max_candidates,
            random_seed=random_seed,
            seeds=seeds,
        )

    def parameters(self) -> dict[str, Any]:
        return {
            "template_id": self.template.id,
            "constraints": self.constraints.to_json(),
            "substituent_sources": list(self.sources),
            "curated_substituent_ids": list(self.curated_ids) if self.curated_ids is not None else None,
            "identical_substituents": self.identical_only,
            "max_candidates": self.max_candidates,
            "random_seed": self.random_seed,
            "seed_count": len(self.seeds),
        }


def list_templates(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    return {
        "templates": template_catalogue(),
        "curated_substituents": [
            {"id": item.id, "name": item.name, "smiles": item.smiles}
            for item in CURATED_SUBSTITUENTS
        ],
        "substituent_sources": list(SUBSTITUENT_SOURCES),
        "limits": {
            "max_candidates": MAX_CANDIDATES,
            "max_seeds": MAX_SEEDS,
            "max_substituents": MAX_SUBSTITUENTS,
        },
        "generator_version": GENERATOR_VERSION,
    }, []


# --- Substituent collection ------------------------------------------------------------------


def curated_substituents(request: GenerationRequest) -> tuple[list[Substituent], list[dict[str, Any]]]:
    accepted: list[Substituent] = []
    rejected: list[dict[str, Any]] = []
    for item in CURATED_SUBSTITUENTS:
        if request.curated_ids is not None and item.id not in request.curated_ids:
            continue
        described = describe_substituent(
            parse_substituent_smiles(item.smiles), source="curated", name=item.name, source_id=item.id
        )
        broken = check_substituent(described, request.constraints)
        if broken:
            rejected.append({"source": "curated", "source_id": item.id, "smiles": described.smiles, "rules": broken})
            continue
        accepted.append(described)
    return accepted, rejected


def seed_substituents(
    request: GenerationRequest,
) -> tuple[list[Substituent], list[dict[str, Any]], list[dict[str, Any]]]:
    """Substituents cut from the seeds, and what happened to each seed.

    Two routes, both filtered by the same constraints as the curated list:

      * `seed_substituents` — a seed that is itself a phosphate ester donates its O-substituents.
      * `brics` — any seed is cut at BRICS bonds; a fragment with exactly one attachment point,
        attached through carbon, is offered as a substituent. BRICS is used only here: it never
        produces or alters the phosphate core, so it cannot take a candidate off-template.
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    accepted: list[Substituent] = []
    rejected: list[dict[str, Any]] = []
    seed_reports: list[dict[str, Any]] = []
    seen: set[str] = set()

    for position, seed in enumerate(request.seeds, start=1):
        seed_id = str(seed.get("id") or f"seed-{position}")
        smiles = str(seed.get("smiles") or "").strip()
        report: dict[str, Any] = {
            "id": seed_id,
            "smiles": smiles,
            "is_phosphate_ester": False,
            "substituents_extracted": 0,
            "brics_fragments": 0,
            "accepted": 0,
            "error": "",
        }
        mol = Chem.MolFromSmiles(smiles) if smiles else None
        if mol is None:
            report["error"] = "Unreadable SMILES."
            seed_reports.append(report)
            continue

        fragments: list[tuple[Any, str]] = []
        if "seed_substituents" in request.sources and is_phosphate_ester(mol):
            report["is_phosphate_ester"] = True
            for _, fragment in extract_substituents(mol):
                fragments.append((fragment, "seed"))
            report["substituents_extracted"] = len(fragments)
        if "brics" in request.sources:
            from rdkit.Chem import BRICS

            for fragment_smiles in sorted(BRICS.BRICSDecompose(mol)):
                fragment = Chem.MolFromSmiles(fragment_smiles)
                if fragment is None:
                    continue
                dummies = [atom for atom in fragment.GetAtoms() if atom.GetAtomicNum() == 0]
                if len(dummies) != 1:
                    continue
                # BRICS leaves its own bond-type label on the dummy; it is not needed once the
                # fragment is treated as a plain O-substituent.
                dummies[0].SetIsotope(0)
                fragments.append((fragment, "brics"))
                report["brics_fragments"] += 1

        for fragment, route in fragments:
            try:
                described = describe_substituent(
                    fragment, source=route, name="", source_id=seed_id
                )
            except ValueError as exc:
                rejected.append({"source": route, "source_id": seed_id, "smiles": Chem.MolToSmiles(fragment), "rules": ["attachment"], "detail": str(exc)})
                continue
            broken = check_substituent(described, request.constraints)
            if broken:
                rejected.append({"source": route, "source_id": seed_id, "smiles": described.smiles, "rules": broken})
                continue
            if described.smiles in seen:
                continue
            seen.add(described.smiles)
            accepted.append(described)
            report["accepted"] += 1
        seed_reports.append(report)
    return accepted, rejected, seed_reports


def collect_substituents(
    request: GenerationRequest,
) -> tuple[list[Substituent], list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[Substituent] = []
    rejected: list[dict[str, Any]] = []
    seed_reports: list[dict[str, Any]] = []
    if "curated" in request.sources:
        curated, curated_rejected = curated_substituents(request)
        accepted.extend(curated)
        rejected.extend(curated_rejected)
    if request.seeds and ({"seed_substituents", "brics"} & set(request.sources)):
        from_seeds, seed_rejected, seed_reports = seed_substituents(request)
        # A seed substituent identical to a curated one is one substituent, credited to both.
        known = {item.smiles: item for item in accepted}
        for item in from_seeds:
            if item.smiles in known:
                existing = known[item.smiles]
                existing.source = f"{existing.source}+{item.source}"
                continue
            accepted.append(item)
            known[item.smiles] = item
        rejected.extend(seed_rejected)
    if len(accepted) > MAX_SUBSTITUENTS:
        raise ValueError(
            f"{len(accepted)} substituents were collected, above the {MAX_SUBSTITUENTS} this generator "
            "will combine. Narrow the substituent list or the size limits."
        )
    return accepted, rejected, seed_reports


# --- Generation --------------------------------------------------------------------------------


def _svg(mol) -> str:
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    flat = Chem.Mol(mol)
    rdkit["AllChem"].Compute2DCoords(flat)
    drawer = rdkit["rdMolDraw2D"].MolDraw2DSVG(320, 200)
    drawer.DrawMolecule(flat)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def _identifiers(mol) -> dict[str, Any]:
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    return {
        "smiles_canonical": Chem.MolToSmiles(mol, canonical=True),
        "inchi": Chem.MolToInchi(mol),
        "inchi_key": Chem.MolToInchiKey(mol),
        "formula": rdkit["rdMolDescriptors"].CalcMolFormula(mol),
        "molecular_weight": rdkit["Descriptors"].MolWt(mol),
        "heavy_atom_count": mol.GetNumHeavyAtoms(),
    }


def generate_candidates(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if not str(payload.get("template_id") or "").strip():
        from .seed_design_service import generate_seed_candidates

        return generate_seed_candidates(payload)
    request = GenerationRequest.from_payload(payload)
    substituents, rejected_substituents, seed_reports = collect_substituents(request)
    rng = random.Random(request.random_seed)
    source: CandidateSource = CombinatorialSource(request.identical_only)
    proposals, enumerated_total = source.propose(
        request.template, substituents, request.max_candidates, rng
    )

    core = core_molecule(request.template)
    candidates: list[dict[str, Any]] = []
    rejected_structures: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    duplicates = 0

    for combo in proposals:
        mol = core
        try:
            for position, substituent in zip(request.template.positions, combo):
                mol = attach(mol, position, substituent.mol)
        except Exception as exc:  # an assembly RDKit refuses is a rejected structure, not a crash
            rejected_structures.append(
                {
                    "substituents": [item.smiles for item in combo],
                    "findings": [Finding("assembled", False, f"Assembly failed: {exc}").to_json()],
                }
            )
            continue
        findings = validate_phosphate_candidate(mol, request.template, request.constraints)
        if not all(finding.ok for finding in findings):
            rejected_structures.append(
                {
                    "smiles": _identifiers(mol)["smiles_canonical"],
                    "substituents": [item.smiles for item in combo],
                    "findings": [finding.to_json() for finding in findings],
                }
            )
            continue
        identifiers = _identifiers(mol)
        key = identifiers["inchi_key"] or identifiers["smiles_canonical"]
        if key in seen_keys:
            duplicates += 1
            continue
        seen_keys.add(key)
        seed_ids = sorted({item.source_id for item in combo if item.source != "curated" and item.source_id})
        candidates.append(
            {
                **identifiers,
                "template_id": request.template.id,
                "template_family": request.template.family,
                "esterification_degree": request.template.degree,
                "chemical_classes": classify_phosphate(request.template, list(combo)),
                "substituents": [
                    {"position": position, **item.to_json()}
                    for position, item in zip(request.template.positions, combo)
                ],
                "seed_ids": seed_ids,
                "generator_version": GENERATOR_VERSION,
                "validation": {
                    "status": "valid",
                    "findings": [finding.to_json() for finding in findings],
                },
                "svg": _svg(mol),
            }
        )

    warnings: list[str] = []
    if enumerated_total > request.max_candidates:
        warnings.append(
            f"The request enumerates {enumerated_total} structures; {request.max_candidates} were "
            f"sampled deterministically with random seed {request.random_seed}."
        )
    if not substituents:
        warnings.append(
            "No substituent satisfied the constraints, so nothing could be generated. Widen the "
            "permitted elements, types or size limits, or add seed molecules."
        )
    return {
        "template": {
            "id": request.template.id,
            "family": request.template.family,
            "label": request.template.label,
            "degree": request.template.degree,
            "formula_sketch": request.template.formula_sketch,
        },
        "generator_version": GENERATOR_VERSION,
        "parameters": request.parameters(),
        "random_seed": request.random_seed,
        "substituent_count": len(substituents),
        "substituents": [item.to_json() for item in substituents],
        "rejected_substituents": rejected_substituents,
        "seed_reports": seed_reports,
        "enumerated_total": enumerated_total,
        "proposed_count": len(proposals),
        "duplicate_count": duplicates,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "rejected_structures": rejected_structures,
        "mode": "real",
    }, warnings


def validate_structure(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Runs template rules or general whole-molecule rules on an arbitrary structure."""
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    template_id = str(payload.get("template_id") or "")
    if not template_id.strip():
        from .seed_design_service import MoleculeConstraints, validate_candidate

        mol = Chem.MolFromSmiles(str(payload.get("smiles") or ""))
        findings = validate_candidate(mol, MoleculeConstraints.from_payload(payload.get("candidate_constraints")))
        valid = all(finding.ok for finding in findings)
        data = {"valid": valid, "findings": [finding.to_json() for finding in findings], "validation_scope": "general_structure"}
        data.update(_identifiers(mol) if valid else {"smiles": str(payload.get("smiles") or "")})
        return data, []
    template = TEMPLATES.get(template_id)
    if template is None:
        raise ValueError(f"Unknown template '{template_id}'.")
    constraints = SubstituentConstraints.from_payload(payload.get("constraints") or {})
    smiles = str(payload.get("smiles") or "").strip()
    mol = Chem.MolFromSmiles(smiles) if smiles else None
    if mol is None:
        return {
            "valid": False,
            "smiles": smiles,
            "findings": [Finding("sanitized", False, "Unreadable SMILES.").to_json()],
        }, []
    findings = validate_phosphate_candidate(mol, template, constraints)
    valid = all(finding.ok for finding in findings)
    data: dict[str, Any] = {
        "valid": valid,
        "findings": [finding.to_json() for finding in findings],
        "is_phosphate_ester": is_phosphate_ester(mol),
    }
    if valid:
        data.update(_identifiers(mol))
    else:
        data["smiles"] = smiles
    return data, []
