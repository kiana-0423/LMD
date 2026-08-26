use crate::app_paths::{default_database_path, default_workspace_dir, set_active_workspace};
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use crate::db::migrations::{
    create_workspace_directories, initialize_database_at, initialize_database_file,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub fn create_workspace(app: AppHandle, path: String) -> Result<Value, String> {
    let workspace = PathBuf::from(path);
    create_workspace_directories(&workspace)?;
    let workspace = workspace
        .canonicalize()
        .map_err(|err| format!("Failed to resolve new workspace path: {err}"))?;
    initialize_database_at(&workspace)?;
    set_active_workspace(&app, &workspace)?;
    ok(
        "create_workspace",
        json!({ "workspace_path": workspace, "status": "created" }),
    )
}

#[tauri::command]
pub fn open_workspace(app: AppHandle, path: String) -> Result<Value, String> {
    let workspace = PathBuf::from(path);
    if !workspace.is_dir() {
        return Err(format!(
            "Workspace directory does not exist: {}",
            workspace.display()
        ));
    }
    let workspace = workspace
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace path: {err}"))?;
    initialize_database_at(&workspace)?;
    set_active_workspace(&app, &workspace)?;
    ok(
        "open_workspace",
        json!({ "workspace_path": workspace, "status": "opened" }),
    )
}

#[tauri::command]
pub async fn get_workspace_status(app: AppHandle) -> Result<Value, String> {
    let sidecar_status = run_sidecar_command(&app, "health", json!({})).await;

    let mut python_sidecar_status = "unavailable";
    let mut python_sidecar_mode = Value::Null;
    let mut rdkit_mode = Value::Null;
    let mut mordred_mode = Value::Null;
    let mut python_sidecar_error = Value::Null;
    let mut missing_dependencies = Value::Null;

    match sidecar_status {
        Ok(result) => {
            let data = result.get("data").unwrap_or(&Value::Null);
            python_sidecar_mode = data.get("mode").cloned().unwrap_or(Value::Null);
            rdkit_mode = data
                .pointer("/dependencies/rdkit/available")
                .and_then(Value::as_bool)
                .map(|available| {
                    Value::String(
                        if available {
                            "available"
                        } else {
                            "unavailable"
                        }
                        .to_string(),
                    )
                })
                .unwrap_or(Value::Null);
            mordred_mode = data
                .pointer("/dependencies/mordred/available")
                .and_then(Value::as_bool)
                .map(|available| {
                    Value::String(
                        if available {
                            "available"
                        } else {
                            "unavailable"
                        }
                        .to_string(),
                    )
                })
                .unwrap_or(Value::Null);
            // "real" only when the sidecar reports every dependency its production commands
            // need. A build that can calculate descriptors but cannot train a model is not a
            // working sidecar, and calling it one moves the failure to the moment the user asks.
            python_sidecar_status = if python_sidecar_mode.as_str() == Some("real") {
                "real"
            } else {
                "unavailable"
            };
            missing_dependencies = data.get("missing").cloned().unwrap_or(Value::Null);
            if python_sidecar_status != "real" {
                python_sidecar_error = result
                    .get("warnings")
                    .and_then(Value::as_array)
                    .and_then(|warnings| warnings.first())
                    .cloned()
                    .unwrap_or_else(|| {
                        Value::String(
                            "The packaged sidecar did not report a usable dependency set."
                                .to_string(),
                        )
                    });
            }
        }
        Err(err) => {
            python_sidecar_error = Value::String(err);
        }
    }

    let database_path = default_database_path(&app)?;
    let (sqlite_status, sqlite_error) = match probe_database(&database_path) {
        Ok(()) => ("ready", Value::Null),
        Err(err) => ("unavailable", Value::String(err)),
    };

    ok(
        "get_workspace_status",
        json!({
            "workspace_path": default_workspace_dir(&app)?,
            "database_path": database_path,
            "sqlite_status": sqlite_status,
            "sqlite_error": sqlite_error,
            "python_sidecar_status": python_sidecar_status,
            "python_sidecar_mode": python_sidecar_mode,
            "rdkit_mode": rdkit_mode,
            "mordred_mode": mordred_mode,
            "python_sidecar_error": python_sidecar_error,
            "python_sidecar_missing": missing_dependencies
        }),
    )
}

/// Confirms the workspace database really answers a query instead of reporting "ready" blindly.
fn probe_database(database_path: &std::path::Path) -> Result<(), String> {
    let connection = crate::db::open_database(database_path)
        .map_err(|err| format!("Failed to open the workspace database: {err}"))?;
    connection
        .query_row("SELECT COUNT(*) FROM molecules", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|_| ())
        .map_err(|err| format!("The workspace database did not answer a query: {err}"))
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

// =================================================================================================
// Workspace management: integrity, backups, and where everything lives
// =================================================================================================

use crate::commands::backup::{
    self, BackupRecord, IntegrityReport, RestoreOutcome, AUTOMATIC_BACKUP_LIMIT,
};
use crate::commands::errors::{self, coded};
use crate::db::migrations::data_quality_issues;
use serde::Serialize;
use std::path::Path;

/// Where a workspace lives and what state it is in — everything Settings needs to show at once.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDetails {
    pub workspace_path: String,
    pub database_path: String,
    pub database_exists: bool,
    pub database_size_bytes: u64,
    pub schema_version: i64,
    /// The version this build writes. A workspace behind it will be migrated when opened.
    pub supported_schema_version: i64,
    pub backup_count: usize,
    pub automatic_backup_limit: usize,
    pub latest_backup: Option<BackupRecord>,
    /// Legacy rows a current rule would reject. Preserved, never corrected — see the migration.
    pub rows_needing_attention: usize,
}

/// The schema version this build writes, exposed so Settings can say what an upgrade will do.
pub const SUPPORTED_SCHEMA_VERSION: i64 = 6;

#[tauri::command]
pub fn get_workspace_details(app: AppHandle) -> Result<WorkspaceDetails, String> {
    let workspace = default_workspace_dir(&app)?;
    let database = default_database_path(&app)?;
    let database_exists = database.is_file();
    let database_size_bytes = std::fs::metadata(&database)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let (schema_version, rows_needing_attention) = if database_exists {
        let connection = crate::db::open_database(&database)
            .map_err(|err| format!("Failed to open the workspace database: {err}"))?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|err| format!("Failed to read the schema version: {err}"))?;
        (version, data_quality_issues(&connection)?.len())
    } else {
        (0, 0)
    };

    let backups = backup::list_backups(&workspace)?;
    Ok(WorkspaceDetails {
        workspace_path: workspace.to_string_lossy().to_string(),
        database_path: database.to_string_lossy().to_string(),
        database_exists,
        database_size_bytes,
        schema_version,
        supported_schema_version: SUPPORTED_SCHEMA_VERSION,
        backup_count: backups.len(),
        automatic_backup_limit: AUTOMATIC_BACKUP_LIMIT,
        latest_backup: backups.first().cloned(),
        rows_needing_attention,
    })
}

/// Runs SQLite's own checks against the live database and reports exactly what they said.
#[tauri::command]
pub fn check_database_integrity(app: AppHandle) -> Result<IntegrityReport, String> {
    backup::verify_database(&default_database_path(&app)?)
}

#[tauri::command]
pub fn list_workspace_backups(app: AppHandle) -> Result<Vec<BackupRecord>, String> {
    backup::list_backups(&default_workspace_dir(&app)?)
}

/// Takes a verified backup on request. Manual backups are never pruned automatically.
#[tauri::command]
pub fn create_workspace_backup(app: AppHandle) -> Result<BackupRecord, String> {
    let workspace = default_workspace_dir(&app)?;
    let database = default_database_path(&app)?;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let destination =
        backup::backup_dir(&workspace)?.join(backup::backup_file_name(&timestamp, false));
    backup::create_backup(&database, &destination)?;
    backup::list_backups(&workspace)?
        .into_iter()
        .find(|record| Path::new(&record.path) == destination)
        .ok_or_else(|| {
            coded(
                errors::BACKUP_FAILED,
                "The backup was written but could not be listed.",
            )
        })
}

/// Replaces the live database with a backup, after the backup has proved itself.
///
/// `confirm_replace` is the acknowledgement: this discards whatever is currently in the workspace,
/// and a command that does that on a single click is a command that will eventually do it by
/// accident. The work being replaced is itself backed up first, so the operation is reversible.
#[tauri::command]
pub fn restore_workspace_backup(
    app: AppHandle,
    path: String,
    confirm_replace: bool,
) -> Result<RestoreOutcome, String> {
    if !confirm_replace {
        return Err(coded(
            errors::RESTORE_REFUSED,
            "Restoring replaces the current workspace database. Confirm the replacement to proceed.",
        ));
    }
    let workspace = default_workspace_dir(&app)?;
    let database = default_database_path(&app)?;
    let candidate = PathBuf::from(&path);
    // A restore may only read from this workspace's own backups folder. Without this a caller
    // could name any path on the machine and have its bytes become the live database.
    let backups = backup::backup_dir(&workspace)?
        .canonicalize()
        .map_err(|err| format!("Failed to resolve the backups folder: {err}"))?;
    let resolved = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve the selected backup: {err}"))?;
    if !resolved.starts_with(&backups) {
        return Err(coded(
            errors::WORKSPACE_PATH_REFUSED,
            format!(
                "A backup must be inside this workspace's backups folder: {}",
                backups.display()
            ),
        ));
    }
    let timestamp = chrono::Utc::now().to_rfc3339();
    backup::restore_backup(&workspace, &database, &resolved, &timestamp)
}

/// Every legacy row a current rule would reject, as data rather than a log line.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataQualityRow {
    pub table_name: String,
    pub row_id: String,
    pub rule: String,
    pub detail: String,
}

#[tauri::command]
pub fn list_rows_needing_attention(app: AppHandle) -> Result<Vec<DataQualityRow>, String> {
    let connection = crate::db::open_database(default_database_path(&app)?)
        .map_err(|err| format!("Failed to open the workspace database: {err}"))?;
    Ok(data_quality_issues(&connection)?
        .into_iter()
        .map(|issue| DataQualityRow {
            table_name: issue.table_name,
            row_id: issue.row_id,
            rule: issue.rule,
            detail: issue.detail,
        })
        .collect())
}
