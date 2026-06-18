from __future__ import annotations

from typing import Any


def predict_additive_screening(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    return {
        "mode": "mock",
        "candidates": [
            {
                "name": "ZDDP-like additive",
                "prediction_score": 0.88,
                "uncertainty": 0.07,
                "reason": "Mock P/S/Zn descriptor signature."
            }
        ],
        "input": payload,
    }, []


def optimize_formulation_mock(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    return {
        "mode": "mock",
        "recommendations": [
            {
                "formulation": "PAO-6 + ZDDP 0.8% + antioxidant 0.2%",
                "predicted_friction_coefficient": 0.079,
                "predicted_wear_scar_diameter": 405,
                "predicted_oxidation_temperature": 262,
                "predicted_extreme_pressure_value": 650,
            }
        ],
        "input": payload,
    }, []
