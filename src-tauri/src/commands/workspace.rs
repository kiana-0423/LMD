use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use crate::db::migrations::{create_workspace_directories, initialize_database_file};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub fn create_workspace(path: String) -> Result<Value, String> {
    let workspace = PathBuf::from(path);
    create_workspace_directories(&workspace)?;
    ok("create_workspace", json!({ "workspace_path": workspace }))
}

#[tauri::command]
pub fn open_workspace(path: String) -> Result<Value, String> {
    ok(
        "open_workspace",
        json!({ "workspace_path": path, "status": "opened_mock" }),
    )
}

#[tauri::command]
pub async fn get_workspace_status(app: AppHandle) -> Result<Value, String> {
    let sidecar_status = run_sidecar_command(
        &app,
        "calculate-required-descriptors",
        json!({
            "smiles": "CCO",
            "require_rdkit": true,
            "require_mordred": true,
            "allow_mock": false
        }),
    )
    .await;

    let mut python_sidecar_status = "unavailable";
    let mut python_sidecar_mode = Value::Null;
    let mut rdkit_mode = Value::Null;
    let mut mordred_mode = Value::Null;
    let mut python_sidecar_error = Value::Null;

    match sidecar_status {
        Ok(result) => {
            let data = result.get("data").unwrap_or(&Value::Null);
            python_sidecar_mode = data.get("mode").cloned().unwrap_or(Value::Null);
            rdkit_mode = data
                .get("rdkit")
                .and_then(|value| value.get("mode"))
                .cloned()
                .unwrap_or(Value::Null);
            mordred_mode = data
                .get("mordred")
                .and_then(|value| value.get("mode"))
                .cloned()
                .unwrap_or(Value::Null);
            python_sidecar_status = if python_sidecar_mode.as_str() == Some("real")
                && rdkit_mode.as_str() == Some("real")
                && mordred_mode.as_str() == Some("real")
            {
                "real"
            } else {
                "mock"
            };
        }
        Err(err) => {
            python_sidecar_error = Value::String(err);
        }
    }

    ok(
        "get_workspace_status",
        json!({
            "workspace_path": default_workspace_dir(&app)?,
            "database_path": default_database_path(&app)?,
            "sqlite_status": "ready",
            "python_sidecar_status": python_sidecar_status,
            "python_sidecar_mode": python_sidecar_mode,
            "rdkit_mode": rdkit_mode,
            "mordred_mode": mordred_mode,
            "python_sidecar_error": python_sidecar_error
        }),
    )
}

#[tauri::command]
pub fn create_default_directories(app: AppHandle) -> Result<Value, String> {
    let workspace = default_workspace_dir(&app)?;
    create_workspace_directories(&workspace)?;
    ok(
        "create_default_directories",
        json!({ "workspace_path": workspace }),
    )
}

#[tauri::command]
pub fn initialize_database(app: AppHandle) -> Result<Value, String> {
    initialize_database_file(&app)?;
    ok("initialize_database", json!({ "status": "initialized" }))
}

#[cfg(test)]
mod tests {
    use crate::commands::ok;
    use serde_json::json;

    #[test]
    fn ok_marks_response_successful() {
        let value = ok("demo", json!({ "id": "1" })).expect("ok should return a value");
        assert_eq!(value["ok"], true);
    }

    #[test]
    fn ok_preserves_command_name() {
        let value = ok("create_workspace", json!({})).expect("ok should return a value");
        assert_eq!(value["command"], "create_workspace");
    }

    #[test]
    fn ok_returns_empty_warnings_for_real_commands() {
        let value = ok("initialize_database", json!({ "status": "initialized" }))
            .expect("ok should return a value");
        assert!(value["warnings"]
            .as_array()
            .expect("warnings should be an array")
            .is_empty());
    }
}
