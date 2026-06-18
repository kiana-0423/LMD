use crate::commands::ok;
use serde_json::{json, Value};
use uuid::Uuid;

#[tauri::command]
pub fn create_base_oil(payload: Value) -> Result<Value, String> {
    ok(
        "create_base_oil",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_base_oils(filter: Option<Value>) -> Result<Value, String> {
    ok("list_base_oils", json!({ "filter": filter, "items": [] }))
}

#[tauri::command]
pub fn create_additive(payload: Value) -> Result<Value, String> {
    ok(
        "create_additive",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_additives(filter: Option<Value>) -> Result<Value, String> {
    ok("list_additives", json!({ "filter": filter, "items": [] }))
}
