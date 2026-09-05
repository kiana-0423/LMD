"""Prediction with the evidence needed to judge it.

A number from a fitted model is only as meaningful as the data behind it, and the data behind it
is not visible from the number. This command returns the prediction *and* what a reader needs to
place it:

  * **Descriptor coverage** — which of the model's features fall outside the range the model was
    fitted on, and by how much. A model fitted on molecules of 200–600 Da asked about one of
    1,200 Da is extrapolating, and the reader should see that in the same row as the number.
  * **Nearest training molecules** — the most similar molecules the model has seen, by Tanimoto
    similarity of Morgan fingerprints, with their names. A similarity is an evidence signal; it is
    reported as a value, never converted into a probability or compared with a universal cutoff.
  * **Model disagreement** — for an ensemble, the spread of the members' predictions. Reported
    only where the fitted estimator actually has members; a Ridge model has none, and inventing a
    spread for it would be fabrication.
  * **Validation support** — the held-out error the model recorded, how the split was grouped,
    and on how many independent molecules the error was measured.

The statuses a reader sees ("supported", "exploratory", "unavailable") are decided by the
caller from this evidence and its own knowledge of the request; this module reports what is
measurable and does not rank anything.
"""

from __future__ import annotations

from typing import Any

from .ml_service import feature_matrix, load_bundle
from .rdkit_service import require_rdkit

NEAREST_NEIGHBOURS = 5
FINGERPRINT_RADIUS = 2
FINGERPRINT_BITS = 2048


def _fingerprint(mol):
    from rdkit.Chem import rdFingerprintGenerator

    generator = rdFingerprintGenerator.GetMorganGenerator(
        radius=FINGERPRINT_RADIUS, fpSize=FINGERPRINT_BITS
    )
    return generator.GetFingerprint(mol)


def _training_fingerprints(domain: dict[str, Any]) -> list[tuple[dict[str, Any], Any]]:
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    prepared: list[tuple[dict[str, Any], Any]] = []
    for molecule in domain.get("training_molecules") or []:
        smiles = str(molecule.get("smiles") or "")
        if not smiles:
            continue
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            continue
        prepared.append((molecule, _fingerprint(mol)))
    return prepared


def _feature_coverage(
    feature_order: list[str], values: list[float], ranges: dict[str, list[float]]
) -> dict[str, Any]:
    outside: list[dict[str, Any]] = []
    compared = 0
    for name, value in zip(feature_order, values):
        span = ranges.get(name)
        if span is None or value != value:
            continue
        compared += 1
        low, high = float(span[0]), float(span[1])
        if value < low or value > high:
            width = high - low
            # Distance beyond the range, in units of the range's own width — so "0.5" means half
            # a training range beyond the edge. Undefined for a constant column, reported as None.
            distance = (low - value if value < low else value - high) / width if width > 0 else None
            outside.append(
                {
                    "feature": name,
                    "value": value,
                    "training_min": low,
                    "training_max": high,
                    "relative_distance": distance,
                }
            )
    outside.sort(key=lambda item: -(item["relative_distance"] or 0.0))
    return {
        "compared_features": compared,
        "outside_range_count": len(outside),
        "fraction_in_range": (compared - len(outside)) / compared if compared else None,
        "outside_range": outside[:10],
    }


def _ensemble_spread(pipeline, matrix) -> dict[str, Any] | None:
    """Per-member predictions for an ensemble, or ``None`` when the estimator has no members."""
    np = require_numpy()
    estimator = pipeline.steps[-1][1]
    members = getattr(estimator, "estimators_", None)
    if members is None or len(members) == 0:
        return None
    transformed = matrix
    for _, step in pipeline.steps[:-1]:
        transformed = step.transform(transformed)
    try:
        member_predictions = np.array([member.predict(transformed) for member in members])
    except Exception:  # an estimator whose members cannot predict alone contributes no spread
        return None
    return {
        "method": "random_forest_tree_spread",
        "member_count": int(len(members)),
        "std": [float(value) for value in member_predictions.std(axis=0)],
        "min": [float(value) for value in member_predictions.min(axis=0)],
        "max": [float(value) for value in member_predictions.max(axis=0)],
    }


def require_numpy():
    try:
        import numpy as np

        return np
    except Exception as exc:  # pragma: no cover - depends on the packaged environment
        raise RuntimeError(f"NumPy is required for assessment: {exc}") from exc


def assess_candidates(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    rdkit = require_rdkit()
    Chem = rdkit["Chem"]
    from rdkit import DataStructs

    bundle = load_bundle(payload["model_path"], payload.get("feature_schema_version"))
    items: list[dict[str, Any]] = payload.get("items") or []
    matrix = feature_matrix(bundle, items)
    feature_order: list[str] = list(bundle["feature_order"])
    predictions = bundle["pipeline"].predict(matrix)
    spread = _ensemble_spread(bundle["pipeline"], matrix)

    domain: dict[str, Any] = bundle.get("domain") or {}
    domain_recorded = bool(domain.get("recorded"))
    ranges: dict[str, list[float]] = domain.get("feature_ranges") or {}
    training = _training_fingerprints(domain) if domain_recorded else []
    neighbours = int(payload.get("neighbours") or NEAREST_NEIGHBOURS)

    results: list[dict[str, Any]] = []
    warnings: list[str] = []
    for index, item in enumerate(items):
        row = [float(value) for value in matrix[index]]
        evidence: dict[str, Any] = {
            "domain_recorded": domain_recorded,
            "feature_coverage": _feature_coverage(feature_order, row, ranges) if domain_recorded else None,
            "nearest_training": None,
            "model_disagreement": None,
        }
        smiles = str(item.get("smiles") or "")
        mol = Chem.MolFromSmiles(smiles) if smiles else None
        if mol is not None and training:
            query = _fingerprint(mol)
            query_key = Chem.MolToInchiKey(mol)
            scored: list[dict[str, Any]] = []
            for molecule, fingerprint in training:
                similarity = float(DataStructs.TanimotoSimilarity(query, fingerprint))
                scored.append(
                    {
                        "id": molecule.get("id", ""),
                        "label": molecule.get("label", ""),
                        "smiles": molecule.get("smiles", ""),
                        "rows": molecule.get("rows", 0),
                        "similarity": similarity,
                    }
                )
            scored.sort(key=lambda entry: -entry["similarity"])
            identical = [
                entry
                for entry in scored
                if entry["similarity"] >= 1.0
                and Chem.MolToInchiKey(Chem.MolFromSmiles(entry["smiles"])) == query_key
            ]
            evidence["nearest_training"] = {
                "method": f"Tanimoto similarity of Morgan fingerprints (radius {FINGERPRINT_RADIUS}, {FINGERPRINT_BITS} bits)",
                "training_molecule_count": len(training),
                "max_similarity": scored[0]["similarity"] if scored else None,
                "nearest": scored[:neighbours],
                "identical_training_molecule": identical[0]["id"] if identical else None,
            }
        elif domain_recorded and not smiles:
            warnings.append(f"Item {item.get('id', index + 1)} carries no SMILES, so no nearest-neighbour evidence could be computed.")
        if spread is not None:
            evidence["model_disagreement"] = {
                "method": spread["method"],
                "member_count": spread["member_count"],
                "std": spread["std"][index],
                "min": spread["min"][index],
                "max": spread["max"][index],
            }
        results.append(
            {
                "id": str(item.get("id", "")),
                "label": str(item.get("label", "")),
                "value": float(predictions[index]),
                "evidence": evidence,
            }
        )

    if not domain_recorded:
        warnings.append(
            "This model was trained before domain evidence was recorded, so descriptor coverage "
            "and nearest-neighbour support cannot be reported. Retrain the model to record them."
        )

    validation = domain.get("validation") if domain_recorded else None
    return {
        "mode": "real",
        "target": bundle.get("target", ""),
        "algorithm": bundle.get("algorithm", ""),
        "model_version": bundle.get("format_version", ""),
        "dataset_mode": bundle.get("dataset_mode", "unknown"),
        "feature_schema_version": bundle.get("feature_schema_version", "unknown"),
        "concentration_basis": bundle.get("concentration_basis", "unknown"),
        "feature_count": len(feature_order),
        "model_evidence": {
            "domain_recorded": domain_recorded,
            "split_method": bundle.get("split_method", "unknown"),
            "split_grouping": domain.get("split_grouping", "unknown") if domain_recorded else "unknown",
            "validation": validation,
            "training_molecule_count": domain.get("molecule_count", 0) if domain_recorded else None,
            "training_row_count": domain.get("row_count", 0) if domain_recorded else None,
            "leakage_group_count": domain.get("leakage_group_count", 0) if domain_recorded else None,
            "target_range": domain.get("target_range") if domain_recorded else None,
            "conditions": domain.get("conditions") if domain_recorded else None,
            "dataset_scope": domain.get("dataset_scope") if domain_recorded else None,
            "disagreement_method": spread["method"] if spread else None,
        },
        "items": results,
    }, warnings
