"""Chemical-class templates for constrained molecular design.

A template is a fixed core with numbered attachment positions. Generation never edits the core: it
grafts permitted substituents onto the positions and validates the *complete* structure afterwards
with substructure rules that name the class precisely. Checking for the presence of phosphorus
would accept a phosphite, a phosphonate, a thiophosphate, a zinc salt and a pyrophosphate under a
"phosphate ester" label; the rules below reject every one of those and say which rule did so.

The first family is phosphate esters. Adding a family means adding a `Template` and, if its
chemistry needs rules the phosphate ones do not express, a validator for it — the generator, the
substituent library and the deduplication are shared.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .rdkit_service import require_rdkit

# Bumped whenever the templates, the substituent library, the assembly, or the validation rules
# change. A candidate records the version it was generated under, so a structure produced by an
# older build can be told apart from one produced by this one.
GENERATOR_VERSION = "phosphate-template-1.0.0"

FAMILY_PHOSPHATE_ESTER = "phosphate_ester"


@dataclass(frozen=True)
class Template:
    id: str
    family: str
    label: str
    formula_sketch: str
    core_smiles: str
    degree: int
    chemical_classes: tuple[str, ...]
    description: str

    @property
    def positions(self) -> tuple[int, ...]:
        return tuple(range(1, self.degree + 1))


TEMPLATES: dict[str, Template] = {
    "phosphate_monoester": Template(
        id="phosphate_monoester",
        family=FAMILY_PHOSPHATE_ESTER,
        label="Phosphate monoester",
        formula_sketch="O=P(OH)2(OR)",
        core_smiles="O=P(O)(O)O[1*]",
        degree=1,
        chemical_classes=("organophosphate", "phosphate_ester", "phosphate_monoester"),
        description="One O-substituent on a phosphate core; two acidic P-OH groups remain.",
    ),
    "phosphate_diester": Template(
        id="phosphate_diester",
        family=FAMILY_PHOSPHATE_ESTER,
        label="Phosphate diester",
        formula_sketch="O=P(OH)(OR1)(OR2)",
        core_smiles="O=P(O)(O[1*])O[2*]",
        degree=2,
        chemical_classes=("organophosphate", "phosphate_ester", "phosphate_diester"),
        description="Two O-substituents on a phosphate core; one acidic P-OH group remains.",
    ),
    "phosphate_triester": Template(
        id="phosphate_triester",
        family=FAMILY_PHOSPHATE_ESTER,
        label="Phosphate triester",
        formula_sketch="O=P(OR1)(OR2)(OR3)",
        core_smiles="O=P(O[1*])(O[2*])O[3*]",
        degree=3,
        chemical_classes=("organophosphate", "phosphate_ester", "phosphate_triester"),
        description="Three O-substituents on a phosphate core; no acidic P-OH group remains.",
    ),
}


# --- Substituents ------------------------------------------------------------------------------

SUBSTITUENT_TYPES: tuple[str, ...] = (
    "linear_alkyl",
    "branched_alkyl",
    "alkenyl",
    "cycloalkyl",
    "aryl",
    "alkylaryl",
    "aralkyl",
    "heteroatom_alkyl",
)

# Elements a substituent may be built from, when the user permits them. Metals are never
# permitted: a metal-containing structure is a salt or a complex, not an ester.
SELECTABLE_ELEMENTS: tuple[str, ...] = ("C", "H", "O", "N", "S", "F", "Cl", "Br", "Si")
DEFAULT_PERMITTED_ELEMENTS: tuple[str, ...] = ("C", "H", "O")

METALS: frozenset[str] = frozenset(
    {
        "Li", "Na", "K", "Rb", "Cs", "Be", "Mg", "Ca", "Sr", "Ba",
        "Al", "Ga", "In", "Sn", "Pb", "Bi", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni",
        "Cu", "Zn", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "Hf", "Ta",
        "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "La", "Ce", "Sb", "Ge", "Tl",
    }
)


@dataclass(frozen=True)
class CuratedSubstituent:
    id: str
    name: str
    smiles: str


# Curated O-substituents. Each SMILES carries exactly one `[*]` on the atom that bonds to the
# ester oxygen. The list is deliberately drawn from groups that occur in commercial phosphate
# esters, but presence here is not a claim about performance or availability.
CURATED_SUBSTITUENTS: tuple[CuratedSubstituent, ...] = (
    CuratedSubstituent("ethyl", "Ethyl", "[*]CC"),
    CuratedSubstituent("n_propyl", "n-Propyl", "[*]CCC"),
    CuratedSubstituent("isopropyl", "Isopropyl", "[*]C(C)C"),
    CuratedSubstituent("n_butyl", "n-Butyl", "[*]CCCC"),
    CuratedSubstituent("isobutyl", "Isobutyl", "[*]CC(C)C"),
    CuratedSubstituent("sec_butyl", "sec-Butyl", "[*]C(C)CC"),
    CuratedSubstituent("tert_butyl", "tert-Butyl", "[*]C(C)(C)C"),
    CuratedSubstituent("n_hexyl", "n-Hexyl", "[*]CCCCCC"),
    CuratedSubstituent("two_ethylhexyl", "2-Ethylhexyl", "[*]CC(CC)CCCC"),
    CuratedSubstituent("n_octyl", "n-Octyl", "[*]CCCCCCCC"),
    CuratedSubstituent("isooctyl", "Isooctyl (6-methylheptyl)", "[*]CCCCCC(C)C"),
    CuratedSubstituent("n_decyl", "n-Decyl", "[*]CCCCCCCCCC"),
    CuratedSubstituent("isodecyl", "Isodecyl (8-methylnonyl)", "[*]CCCCCCCC(C)C"),
    CuratedSubstituent("n_dodecyl", "n-Dodecyl (lauryl)", "[*]CCCCCCCCCCCC"),
    CuratedSubstituent("tridecyl", "n-Tridecyl", "[*]CCCCCCCCCCCCC"),
    CuratedSubstituent("n_hexadecyl", "n-Hexadecyl (cetyl)", "[*]CCCCCCCCCCCCCCCC"),
    CuratedSubstituent("n_octadecyl", "n-Octadecyl (stearyl)", "[*]CCCCCCCCCCCCCCCCCC"),
    CuratedSubstituent("oleyl", "Oleyl (cis-9-octadecenyl)", "[*]CCCCCCCC/C=C\\CCCCCCCC"),
    CuratedSubstituent("cyclohexyl", "Cyclohexyl", "[*]C1CCCCC1"),
    CuratedSubstituent("phenyl", "Phenyl", "[*]c1ccccc1"),
    CuratedSubstituent("o_tolyl", "o-Tolyl (o-cresyl)", "[*]c1ccccc1C"),
    CuratedSubstituent("m_tolyl", "m-Tolyl (m-cresyl)", "[*]c1cccc(C)c1"),
    CuratedSubstituent("p_tolyl", "p-Tolyl (p-cresyl)", "[*]c1ccc(C)cc1"),
    CuratedSubstituent("two_six_xylyl", "2,6-Xylyl", "[*]c1c(C)cccc1C"),
    CuratedSubstituent("three_five_xylyl", "3,5-Xylyl", "[*]c1cc(C)cc(C)c1"),
    CuratedSubstituent("four_tert_butylphenyl", "4-tert-Butylphenyl", "[*]c1ccc(C(C)(C)C)cc1"),
    CuratedSubstituent("four_isopropylphenyl", "4-Isopropylphenyl", "[*]c1ccc(C(C)C)cc1"),
    CuratedSubstituent("four_nonylphenyl", "4-Nonylphenyl", "[*]c1ccc(CCCCCCCCC)cc1"),
    CuratedSubstituent("benzyl", "Benzyl", "[*]Cc1ccccc1"),
    CuratedSubstituent("two_phenylethyl", "2-Phenylethyl", "[*]CCc1ccccc1"),
    CuratedSubstituent("two_methoxyethyl", "2-Methoxyethyl", "[*]CCOC"),
    CuratedSubstituent("two_butoxyethyl", "2-Butoxyethyl", "[*]CCOCCCC"),
)


@dataclass
class SubstituentConstraints:
    """What a substituent may be. Every limit is explicit and echoed back with the candidates."""

    permitted_elements: tuple[str, ...] = DEFAULT_PERMITTED_ELEMENTS
    allowed_types: tuple[str, ...] = SUBSTITUENT_TYPES
    min_heavy_atoms: int = 1
    max_heavy_atoms: int = 24
    max_branch_points: int = 4

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SubstituentConstraints":
        elements = tuple(
            str(symbol) for symbol in (payload.get("permitted_elements") or DEFAULT_PERMITTED_ELEMENTS)
        )
        unknown = [symbol for symbol in elements if symbol not in SELECTABLE_ELEMENTS]
        if unknown:
            raise ValueError(
                f"Permitted elements must be chosen from {', '.join(SELECTABLE_ELEMENTS)}; "
                f"got {', '.join(unknown)}."
            )
        # Carbon and hydrogen are what an organic substituent is made of; a permitted set without
        # them would admit nothing and is a mistake rather than a choice.
        elements = tuple(sorted(set(elements) | {"C", "H"}, key=SELECTABLE_ELEMENTS.index))
        types = tuple(str(item) for item in (payload.get("allowed_types") or SUBSTITUENT_TYPES))
        unknown_types = [item for item in types if item not in SUBSTITUENT_TYPES]
        if unknown_types:
            raise ValueError(
                f"Substituent types must be chosen from {', '.join(SUBSTITUENT_TYPES)}; "
                f"got {', '.join(unknown_types)}."
            )
        min_heavy = int(payload.get("min_heavy_atoms") or 1)
        max_heavy = int(payload.get("max_heavy_atoms") or 24)
        max_branch = int(payload.get("max_branch_points") if payload.get("max_branch_points") is not None else 4)
        if min_heavy < 1 or max_heavy < min_heavy or max_heavy > 60 or max_branch < 0:
            raise ValueError(
                "Substituent size limits must satisfy 1 <= min_heavy_atoms <= max_heavy_atoms <= 60 "
                "and max_branch_points >= 0."
            )
        return cls(
            permitted_elements=elements,
            allowed_types=types,
            min_heavy_atoms=min_heavy,
            max_heavy_atoms=max_heavy,
            max_branch_points=max_branch,
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "permitted_elements": list(self.permitted_elements),
            "allowed_types": list(self.allowed_types),
            "min_heavy_atoms": self.min_heavy_atoms,
            "max_heavy_atoms": self.max_heavy_atoms,
            "max_branch_points": self.max_branch_points,
        }


@dataclass
class Substituent:
    """One permitted organic substituent, described by the same classifier whatever its source."""

    smiles: str
    type: str
    heavy_atoms: int
    branch_points: int
    elements: tuple[str, ...]
    source: str
    name: str = ""
    source_id: str = ""
    mol: Any = field(default=None, repr=False, compare=False)

    def to_json(self) -> dict[str, Any]:
        return {
            "smiles": self.smiles,
            "name": self.name,
            "type": self.type,
            "heavy_atoms": self.heavy_atoms,
            "branch_points": self.branch_points,
            "elements": list(self.elements),
            "source": self.source,
            "source_id": self.source_id,
        }


def _dummy_atoms(mol) -> list[int]:
    return [atom.GetIdx() for atom in mol.GetAtoms() if atom.GetAtomicNum() == 0]


def describe_substituent(fragment, *, source: str, name: str = "", source_id: str = "") -> Substituent:
    """Classifies a fragment carrying exactly one dummy attachment atom.

    Raises `ValueError` for anything that cannot be an O-substituent at all: several attachment
    points, an attachment through a heteroatom, or an empty fragment.
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    dummies = _dummy_atoms(fragment)
    if len(dummies) != 1:
        raise ValueError(f"A substituent needs exactly one attachment point; found {len(dummies)}.")
    dummy = fragment.GetAtomWithIdx(dummies[0])
    neighbors = dummy.GetNeighbors()
    if len(neighbors) != 1:
        raise ValueError("The attachment point must bond to exactly one atom.")
    attachment = neighbors[0]
    if attachment.GetAtomicNum() != 6:
        raise ValueError("The substituent must attach to the ester oxygen through a carbon atom.")
    if dummy.GetBonds()[0].GetBondType() != Chem.BondType.SINGLE:
        raise ValueError("The attachment bond must be single.")

    heavy = [atom for atom in fragment.GetAtoms() if atom.GetAtomicNum() > 1]
    elements = sorted({atom.GetSymbol() for atom in heavy} | {"H"})
    heavy_count = len(heavy)
    aromatic = any(atom.GetIsAromatic() for atom in heavy)
    ring_info = fragment.GetRingInfo()
    has_ring = ring_info.NumRings() > 0 if ring_info is not None else False
    hetero = [atom for atom in heavy if atom.GetSymbol() not in {"C"}]
    unsaturated = any(
        bond.GetBondType() in (Chem.BondType.DOUBLE, Chem.BondType.TRIPLE) and not bond.GetIsAromatic()
        for bond in fragment.GetBonds()
    )
    # A branch point is an aliphatic carbon bonded to three or more heavy atoms, counting the
    # attachment point as the ester oxygen it will become: isopropyl is branched at the carbon
    # that carries the oxygen, and that is the shape a "branched" alkyl chain is named for.
    branch_points = 0
    for atom in heavy:
        if atom.GetAtomicNum() != 6 or atom.GetIsAromatic():
            continue
        real_neighbors = [nbr for nbr in atom.GetNeighbors() if nbr.GetAtomicNum() != 1]
        if len(real_neighbors) >= 3:
            branch_points += 1

    if aromatic:
        if attachment.GetIsAromatic():
            aliphatic_carbons = [
                atom for atom in heavy if atom.GetAtomicNum() == 6 and not atom.GetIsAromatic()
            ]
            kind = "alkylaryl" if aliphatic_carbons else "aryl"
        else:
            kind = "aralkyl"
    elif hetero:
        kind = "heteroatom_alkyl"
    elif has_ring:
        kind = "cycloalkyl"
    elif unsaturated:
        kind = "alkenyl"
    elif branch_points > 0:
        kind = "branched_alkyl"
    else:
        kind = "linear_alkyl"

    canonical = Chem.MolToSmiles(fragment, canonical=True)
    return Substituent(
        smiles=canonical,
        type=kind,
        heavy_atoms=heavy_count,
        branch_points=branch_points,
        elements=tuple(elements),
        source=source,
        name=name or canonical,
        source_id=source_id,
        mol=fragment,
    )


def check_substituent(substituent: Substituent, constraints: SubstituentConstraints) -> list[str]:
    """Every constraint the substituent breaks, as rule names. Empty means permitted."""
    broken: list[str] = []
    permitted = set(constraints.permitted_elements)
    if any(symbol not in permitted for symbol in substituent.elements):
        broken.append("permitted_elements")
    if substituent.type not in constraints.allowed_types:
        broken.append("allowed_types")
    if substituent.heavy_atoms < constraints.min_heavy_atoms:
        broken.append("min_heavy_atoms")
    if substituent.heavy_atoms > constraints.max_heavy_atoms:
        broken.append("max_heavy_atoms")
    if substituent.branch_points > constraints.max_branch_points:
        broken.append("max_branch_points")
    return broken


def parse_substituent_smiles(smiles: str):
    rdkit = require_rdkit()
    mol = rdkit["Chem"].MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Unreadable substituent SMILES: {smiles}")
    return mol


# --- Assembly ------------------------------------------------------------------------------------


def core_molecule(template: Template):
    rdkit = require_rdkit()
    mol = rdkit["Chem"].MolFromSmiles(template.core_smiles)
    if mol is None:  # pragma: no cover - the templates are constants
        raise RuntimeError(f"Template {template.id} has an unreadable core.")
    return mol


def attach(core, position: int, fragment):
    """Grafts `fragment` onto the core's numbered attachment position.

    The two dummy atoms are removed and their neighbours joined by a single bond. Nothing else
    about the core is touched, which is what makes the template a constraint rather than a hint.
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    combined = Chem.RWMol(Chem.CombineMols(core, fragment))
    core_atoms = core.GetNumAtoms()
    core_dummies = [
        atom.GetIdx()
        for atom in combined.GetAtoms()
        if atom.GetAtomicNum() == 0 and atom.GetIsotope() == position and atom.GetIdx() < core_atoms
    ]
    fragment_dummies = [
        atom.GetIdx()
        for atom in combined.GetAtoms()
        if atom.GetAtomicNum() == 0 and atom.GetIdx() >= core_atoms
    ]
    if len(core_dummies) != 1:
        raise ValueError(f"The core has no free attachment position {position}.")
    if len(fragment_dummies) != 1:
        raise ValueError("The fragment must carry exactly one attachment point.")
    core_dummy, fragment_dummy = core_dummies[0], fragment_dummies[0]
    core_neighbor = combined.GetAtomWithIdx(core_dummy).GetNeighbors()[0].GetIdx()
    fragment_neighbor = combined.GetAtomWithIdx(fragment_dummy).GetNeighbors()[0].GetIdx()
    combined.AddBond(core_neighbor, fragment_neighbor, Chem.BondType.SINGLE)
    for index in sorted((core_dummy, fragment_dummy), reverse=True):
        combined.RemoveAtom(index)
    mol = combined.GetMol()
    Chem.SanitizeMol(mol)
    return mol


# --- Validation ----------------------------------------------------------------------------------


@dataclass
class Finding:
    rule: str
    ok: bool
    detail: str

    def to_json(self) -> dict[str, Any]:
        return {"rule": self.rule, "ok": self.ok, "detail": self.detail}


def _phosphorus_atoms(mol) -> list[Any]:
    return [atom for atom in mol.GetAtoms() if atom.GetAtomicNum() == 15]


def phosphate_ester_oxygens(mol, phosphorus) -> tuple[list[Any], list[Any], list[str]]:
    """Splits the oxygens on one phosphorus into ester oxygens, hydroxyl oxygens, and problems.

    An oxygen single-bonded to P is an ester oxygen when its other neighbour is a carbon, a
    hydroxyl when it has no other heavy neighbour, and a problem otherwise: an O-Si, an O-S, an
    O-N, an O-O, a second phosphorus (pyrophosphate), or a metal (salt).
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    ester: list[Any] = []
    hydroxyl: list[Any] = []
    problems: list[str] = []
    for bond in phosphorus.GetBonds():
        other = bond.GetOtherAtom(phosphorus)
        if other.GetAtomicNum() != 8 or bond.GetBondType() != Chem.BondType.SINGLE:
            continue
        heavy_neighbors = [nbr for nbr in other.GetNeighbors() if nbr.GetIdx() != phosphorus.GetIdx() and nbr.GetAtomicNum() > 1]
        if not heavy_neighbors:
            if other.GetFormalCharge() != 0:
                problems.append("an anionic P-O⁻ oxygen (a phosphate salt, not an ester)")
            else:
                hydroxyl.append(other)
        elif len(heavy_neighbors) == 1 and heavy_neighbors[0].GetAtomicNum() == 6:
            ester.append(other)
        else:
            symbols = ", ".join(sorted({nbr.GetSymbol() for nbr in heavy_neighbors}))
            problems.append(f"an ester oxygen bonded to {symbols} rather than to carbon")
    return ester, hydroxyl, problems


def validate_phosphate_candidate(
    mol,
    template: Template,
    constraints: SubstituentConstraints,
) -> list[Finding]:
    """Every rule a complete phosphate-ester candidate must satisfy, each reported separately.

    The rules are ordered from the most general to the most specific, and every one runs even
    after an earlier one fails, so a rejected structure explains itself fully.
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    findings: list[Finding] = []

    try:
        Chem.SanitizeMol(mol)
        findings.append(Finding("sanitized", True, "RDKit sanitization succeeded."))
    except Exception as exc:  # a structure RDKit refuses is reportable, not a crash
        findings.append(Finding("sanitized", False, f"RDKit sanitization failed: {exc}"))
        return findings

    fragments = Chem.GetMolFrags(mol)
    findings.append(
        Finding(
            "single_fragment",
            len(fragments) == 1,
            "One covalent structure." if len(fragments) == 1 else f"{len(fragments)} disconnected fragments: a salt or a mixture, not a single ester.",
        )
    )
    charged = [atom for atom in mol.GetAtoms() if atom.GetFormalCharge() != 0]
    findings.append(
        Finding(
            "neutral",
            not charged,
            "No formal charges." if not charged else f"{len(charged)} charged atom(s): an ionic species, not a neutral ester.",
        )
    )
    metals = sorted({atom.GetSymbol() for atom in mol.GetAtoms() if atom.GetSymbol() in METALS})
    findings.append(
        Finding(
            "no_metals",
            not metals,
            "No metal atoms." if not metals else f"Contains {', '.join(metals)}: a metal salt or complex is outside this template.",
        )
    )

    phosphorus = _phosphorus_atoms(mol)
    findings.append(
        Finding(
            "single_phosphorus",
            len(phosphorus) == 1,
            "Exactly one phosphorus atom." if len(phosphorus) == 1 else f"{len(phosphorus)} phosphorus atoms; the template has one.",
        )
    )
    if len(phosphorus) != 1:
        return findings
    p_atom = phosphorus[0]

    # The core: P(V) with one P=O and three single P-O bonds, and nothing else on the phosphorus.
    double_oxygens = 0
    single_oxygens = 0
    other_neighbors: list[str] = []
    for bond in p_atom.GetBonds():
        other = bond.GetOtherAtom(p_atom)
        if other.GetAtomicNum() == 8:
            if bond.GetBondType() == Chem.BondType.DOUBLE:
                double_oxygens += 1
            elif bond.GetBondType() == Chem.BondType.SINGLE:
                single_oxygens += 1
            else:
                other_neighbors.append(f"O ({bond.GetBondType()})")
        else:
            other_neighbors.append(other.GetSymbol())
    core_ok = (
        double_oxygens == 1
        and single_oxygens == 3
        and not other_neighbors
        and p_atom.GetTotalNumHs() == 0
        and p_atom.GetDegree() == 4
    )
    if core_ok:
        detail = "P(=O)(O)(O)O phosphate core present."
    else:
        reasons = []
        if double_oxygens != 1:
            reasons.append(f"{double_oxygens} P=O bond(s) instead of 1")
        if single_oxygens != 3:
            reasons.append(f"{single_oxygens} P-O single bond(s) instead of 3")
        if other_neighbors:
            reasons.append("P bonded to " + ", ".join(other_neighbors) + " (a phosphonate, thiophosphate, phosphoramidate or phosphonium, not a phosphate)")
        if p_atom.GetTotalNumHs() > 0:
            reasons.append("P-H present (an H-phosphonate / phosphite)")
        if p_atom.GetDegree() != 4:
            reasons.append(f"phosphorus has {p_atom.GetDegree()} bonds (a phosphite or other P(III) species)")
        detail = "; ".join(reasons) + "."
    findings.append(Finding("phosphate_core", core_ok, detail))

    ester, hydroxyl, problems = phosphate_ester_oxygens(mol, p_atom)
    findings.append(
        Finding(
            "ester_oxygen_substituents",
            not problems,
            "Every P-O oxygen carries hydrogen or carbon." if not problems else "; ".join(problems) + ".",
        )
    )
    expected_hydroxyl = 3 - template.degree
    degree_ok = len(ester) == template.degree and len(hydroxyl) == expected_hydroxyl and not problems
    findings.append(
        Finding(
            "esterification_degree",
            degree_ok,
            f"{len(ester)} ester oxygen(s) and {len(hydroxyl)} P-OH group(s); the template requires {template.degree} and {expected_hydroxyl}.",
        )
    )

    symbols = {atom.GetSymbol() for atom in mol.GetAtoms()}
    permitted = set(constraints.permitted_elements) | {"P", "O", "H"}
    stray = sorted(symbols - permitted)
    findings.append(
        Finding(
            "permitted_elements",
            not stray,
            "Every element is permitted." if not stray else f"Contains {', '.join(stray)}, which the request does not permit.",
        )
    )

    # Substituent limits are checked on the complete structure by cutting the ester bonds again,
    # so a substituent assembled from a seed is held to the same rule as a curated one.
    if degree_ok:
        limit_problems: list[str] = []
        for position, fragment in extract_substituents(mol):
            try:
                described = describe_substituent(fragment, source="candidate")
            except ValueError as exc:
                limit_problems.append(f"position {position}: {exc}")
                continue
            broken = check_substituent(described, constraints)
            if broken:
                limit_problems.append(
                    f"position {position} ({described.smiles}) breaks {', '.join(broken)}"
                )
        findings.append(
            Finding(
                "substituent_limits",
                not limit_problems,
                "Every substituent is within the requested limits." if not limit_problems else "; ".join(limit_problems) + ".",
            )
        )
    return findings


def extract_substituents(mol) -> list[tuple[int, Any]]:
    """The O-substituents of a phosphate ester, each as a fragment with one dummy atom.

    Cuts one ester O-C bond at a time on a copy, so a substituent that contains a second oxygen
    (an ether chain, say) is not mistaken for a second ester position.
    """
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    phosphorus = _phosphorus_atoms(mol)
    if len(phosphorus) != 1:
        return []
    ester, _, _ = phosphate_ester_oxygens(mol, phosphorus[0])
    substituents: list[tuple[int, Any]] = []
    for position, oxygen in enumerate(ester, start=1):
        carbon = next(nbr for nbr in oxygen.GetNeighbors() if nbr.GetAtomicNum() == 6)
        bond = mol.GetBondBetweenAtoms(oxygen.GetIdx(), carbon.GetIdx())
        # `addDummies` puts a dummy on both ends; only the carbon side is wanted, and its dummy is
        # what marks the attachment point when the fragment is grafted again.
        cut = Chem.FragmentOnBonds(mol, [bond.GetIdx()], addDummies=True, dummyLabels=[(0, 0)])
        pieces = Chem.GetMolFrags(cut, asMols=True, sanitizeFrags=True)
        for piece in pieces:
            if not _phosphorus_atoms(piece):
                substituents.append((position, piece))
                break
    return substituents


def is_phosphate_ester(mol) -> bool:
    """True when the structure has exactly one P(=O)(O)(O)O core with carbon or hydrogen on every oxygen."""
    phosphorus = _phosphorus_atoms(mol)
    if len(phosphorus) != 1:
        return False
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    p_atom = phosphorus[0]
    if p_atom.GetDegree() != 4 or p_atom.GetTotalNumHs() != 0:
        return False
    double = sum(
        1
        for bond in p_atom.GetBonds()
        if bond.GetOtherAtom(p_atom).GetAtomicNum() == 8 and bond.GetBondType() == Chem.BondType.DOUBLE
    )
    single = sum(
        1
        for bond in p_atom.GetBonds()
        if bond.GetOtherAtom(p_atom).GetAtomicNum() == 8 and bond.GetBondType() == Chem.BondType.SINGLE
    )
    if double != 1 or single != 3:
        return False
    _, _, problems = phosphate_ester_oxygens(mol, p_atom)
    return not problems


def classify_phosphate(template: Template, substituents: list[Substituent]) -> list[str]:
    """Structural labels for a generated phosphate ester. Several may apply at once."""
    labels = list(template.chemical_classes)
    types = {item.type for item in substituents}
    aromatic_types = {"aryl", "alkylaryl"}
    aliphatic_types = {"linear_alkyl", "branched_alkyl", "alkenyl", "cycloalkyl", "aralkyl", "heteroatom_alkyl"}
    has_aryl = bool(types & aromatic_types)
    has_alkyl = bool(types & aliphatic_types)
    if has_aryl and has_alkyl:
        labels.append("mixed_alkyl_aryl_phosphate")
    elif has_aryl:
        labels.append("aryl_phosphate")
    elif has_alkyl:
        labels.append("alkyl_phosphate")
    if template.degree < 3:
        labels.append("acid_phosphate")
    return labels


def template_catalogue() -> list[dict[str, Any]]:
    """The templates and their controls, as the interface lists them."""
    return [
        {
            "id": template.id,
            "family": template.family,
            "label": template.label,
            "formula_sketch": template.formula_sketch,
            "degree": template.degree,
            "positions": list(template.positions),
            "chemical_classes": list(template.chemical_classes),
            "description": template.description,
            "generator_version": GENERATOR_VERSION,
        }
        for template in TEMPLATES.values()
    ]
