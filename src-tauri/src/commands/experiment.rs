use crate::commands::ok;
use serde_json::{json, Value};
use uuid::Uuid;

#[tauri::command]
pub fn create_experiment(payload: Value) -> Result<Value, String> {
    ok(
        "create_experiment",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_experiments(filter: Option<Value>) -> Result<Value, String> {
    ok("list_experiments", json!({ "filter": filter, "items": [] }))
}

#[tauri::command]
pub fn create_performance_result(payload: Value) -> Result<Value, String> {
    ok(
        "create_performance_result",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn get_experiment_with_results(id: String) -> Result<Value, String> {
    ok(
        "get_experiment_with_results",
        json!({ "id": id, "results": [] }),
    )
}

#[tauri::command]
pub fn add_attachment(payload: Value) -> Result<Value, String> {
    ok(
        "add_attachment",
        json!({ "id": Uuid::new_v4(), "payload": payload, "relative_path_required": true }),
    )
}
