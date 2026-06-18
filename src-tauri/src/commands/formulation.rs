use crate::commands::ok;
use serde_json::{json, Value};
use uuid::Uuid;

#[tauri::command]
pub fn create_formulation(payload: Value) -> Result<Value, String> {
    ok(
        "create_formulation",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_formulations(filter: Option<Value>) -> Result<Value, String> {
    ok(
        "list_formulations",
        json!({ "filter": filter, "items": [] }),
    )
}

#[tauri::command]
pub fn get_formulation(id: String) -> Result<Value, String> {
    ok("get_formulation", json!({ "id": id }))
}

#[tauri::command]
pub fn add_formulation_component(payload: Value) -> Result<Value, String> {
    ok(
        "add_formulation_component",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn update_formulation_component(id: String, payload: Value) -> Result<Value, String> {
    ok(
        "update_formulation_component",
        json!({ "id": id, "payload": payload }),
    )
}

#[tauri::command]
pub fn delete_formulation_component(id: String) -> Result<Value, String> {
    ok(
        "delete_formulation_component",
        json!({ "id": id, "deleted": false, "phase": "mvp_skeleton" }),
    )
}
