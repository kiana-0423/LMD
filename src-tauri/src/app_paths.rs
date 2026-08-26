use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const ACTIVE_WORKSPACE_FILE: &str = "active-workspace.txt";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))
}

pub fn default_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_data_dir(app)?;
    let selection_file = app_data.join(ACTIVE_WORKSPACE_FILE);
    if selection_file.is_file() {
        let selected = fs::read_to_string(&selection_file)
            .map_err(|err| format!("Failed to read active workspace selection: {err}"))?;
        let selected = PathBuf::from(selected.trim());
        if selected.is_absolute() && selected.is_dir() {
            return Ok(selected);
        }
    }
    Ok(app_data.join("LMD_Workspace"))
}

pub fn default_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(default_workspace_dir(app)?.join("lmd.sqlite"))
}

pub fn set_active_workspace(app: &AppHandle, workspace: &Path) -> Result<(), String> {
    if !workspace.is_absolute() || !workspace.is_dir() {
        return Err("The active workspace must be an existing absolute directory.".to_string());
    }
    let app_data = app_data_dir(app)?;
    fs::create_dir_all(&app_data)
        .map_err(|err| format!("Failed to create application data directory: {err}"))?;
    let selection_file = app_data.join(ACTIVE_WORKSPACE_FILE);
    let temporary_file = app_data.join(format!("{ACTIVE_WORKSPACE_FILE}.tmp"));
    fs::write(&temporary_file, workspace.to_string_lossy().as_bytes())
        .map_err(|err| format!("Failed to stage active workspace selection: {err}"))?;
    match fs::rename(&temporary_file, &selection_file) {
        Ok(()) => Ok(()),
        Err(first_error) if selection_file.is_file() => {
            fs::remove_file(&selection_file).map_err(|err| {
                format!("Failed to replace active workspace selection after {first_error}: {err}")
            })?;
            fs::rename(&temporary_file, &selection_file)
                .map_err(|err| format!("Failed to save active workspace selection: {err}"))
        }
        Err(err) => Err(format!("Failed to save active workspace selection: {err}")),
    }
}
