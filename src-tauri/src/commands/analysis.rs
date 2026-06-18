use crate::commands::ok;
use serde_json::{json, Value};

#[tauri::command]
pub fn get_dashboard_summary() -> Result<Value, String> {
    ok(
        "get_dashboard_summary",
        json!({ "molecule_count": 5, "formulation_count": 4, "experiment_count": 5 }),
    )
}

#[tauri::command]
pub fn get_performance_distribution() -> Result<Value, String> {
    ok("get_performance_distribution", json!({ "series": [] }))
}

#[tauri::command]
pub fn get_descriptor_property_correlation() -> Result<Value, String> {
    ok(
        "get_descriptor_property_correlation",
        json!({ "pearson": null, "spearman": null }),
    )
}

#[tauri::command]
pub fn export_ml_dataset(filter: Option<Value>) -> Result<Value, String> {
    ok(
        "export_ml_dataset",
        json!({ "filter": filter, "status": "mock_csv_ready" }),
    )
}

#[tauri::command]
pub fn run_additive_design_mock(payload: Value) -> Result<Value, String> {
    ok(
        "run_additive_design_mock",
        json!({ "payload": payload, "candidates": [] }),
    )
}

#[tauri::command]
pub fn run_formulation_design_mock(payload: Value) -> Result<Value, String> {
    ok(
        "run_formulation_design_mock",
        json!({ "payload": payload, "recommendations": [] }),
    )
}
