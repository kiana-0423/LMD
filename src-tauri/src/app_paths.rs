use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))
}

pub fn default_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("LMD_Workspace"))
}

pub fn default_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(default_workspace_dir(app)?.join("lmd.sqlite"))
}
