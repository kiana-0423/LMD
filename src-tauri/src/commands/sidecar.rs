use crate::commands::ok;
use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

pub async fn run_sidecar_command(
    app: &AppHandle,
    command_name: &str,
    input: Value,
) -> Result<Value, String> {
    let input_path = std::env::temp_dir().join(format!("lmd-sidecar-{}.json", Uuid::new_v4()));
    fs::write(
        &input_path,
        serde_json::to_vec(&input)
            .map_err(|err| format!("Failed to serialize sidecar input: {err}"))?,
    )
    .map_err(|err| format!("Failed to write sidecar input file: {err}"))?;

    let output = run_packaged_sidecar(app, command_name, &input_path)
        .await
        .map_err(|err| {
            let _ = fs::remove_file(&input_path);
            err
        })?;
    let _ = fs::remove_file(&input_path);

    let stdout = String::from_utf8(output.stdout)
        .map_err(|err| format!("Sidecar stdout is not UTF-8: {err}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let parsed: Value = serde_json::from_str(stdout.trim()).map_err(|err| {
        format!(
            "Failed to parse sidecar JSON for command {command_name}: {err}. stderr: {stderr}. stdout: {stdout}"
        )
    })?;
    if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(parsed)
    } else {
        let error = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Python sidecar command failed");
        Err(error.to_string())
    }
}

async fn run_packaged_sidecar(
    app: &AppHandle,
    command_name: &str,
    input_path: &std::path::Path,
) -> Result<tauri_plugin_shell::process::Output, String> {
    let input_path = input_path
        .to_str()
        .ok_or_else(|| "Sidecar input path is not valid UTF-8".to_string())?;
    let output = app
        .shell()
        .sidecar("lmd-sidecar")
        .map_err(|err| format!("Failed to resolve packaged sidecar: {err}"))?
        .args([command_name, "--input", input_path])
        .output()
        .await
        .map_err(|err| format!("Failed to launch packaged sidecar: {err}"))?;

    if output.status.success() {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "Packaged sidecar command {command_name} failed. stderr: {stderr}. stdout: {stdout}"
    ))
}

#[tauri::command]
pub async fn standardize_molecule_with_sidecar(
    app: AppHandle,
    smiles: String,
) -> Result<Value, String> {
    run_sidecar_command(&app, "standardize", json!({ "smiles": smiles })).await
}

#[tauri::command]
pub async fn calculate_descriptors_with_sidecar(
    app: AppHandle,
    smiles: String,
    descriptor_set: String,
) -> Result<Value, String> {
    let command_name = match descriptor_set.as_str() {
        "rdkit" => "rdkit-descriptors",
        "mordred" => "mordred-descriptors",
        other => return Err(format!("Unsupported descriptor_set: {other}")),
    };
    run_sidecar_command(
        &app,
        command_name,
        json!({ "smiles": smiles, "allow_mock": true }),
    )
    .await
}

#[tauri::command]
pub async fn calculate_required_descriptors_with_sidecar(
    app: AppHandle,
    smiles: String,
    allow_mock: bool,
) -> Result<Value, String> {
    run_sidecar_command(
        &app,
        "calculate-required-descriptors",
        json!({
            "smiles": smiles,
            "require_rdkit": true,
            "require_mordred": true,
            "allow_mock": allow_mock
        }),
    )
    .await
}

#[tauri::command]
pub async fn validate_smiles_with_sidecar(
    app: AppHandle,
    smiles: String,
) -> Result<Value, String> {
    run_sidecar_command(&app, "validate-smiles", json!({ "smiles": smiles })).await
}

#[tauri::command]
pub async fn molfile_to_smiles_with_sidecar(
    app: AppHandle,
    molfile: String,
) -> Result<Value, String> {
    run_sidecar_command(&app, "molfile-to-smiles", json!({ "molfile": molfile })).await
}

#[tauri::command]
pub async fn smiles_to_molfile_with_sidecar(
    app: AppHandle,
    smiles: String,
) -> Result<Value, String> {
    run_sidecar_command(&app, "smiles-to-molfile", json!({ "smiles": smiles })).await
}

#[tauri::command]
pub async fn calculate_sketcher_descriptors_with_sidecar(
    app: AppHandle,
    smiles: String,
    allow_mock: bool,
) -> Result<Value, String> {
    run_sidecar_command(
        &app,
        "calculate-sketcher-descriptors",
        json!({ "smiles": smiles, "allow_mock": allow_mock }),
    )
    .await
}

#[tauri::command]
pub fn import_excel_with_sidecar(file_path: String) -> Result<Value, String> {
    ok(
        "import_excel_with_sidecar",
        json!({ "file_path": file_path, "preview_rows": [] }),
    )
}

#[tauri::command]
pub fn predict_additive_with_sidecar(payload: Value) -> Result<Value, String> {
    ok(
        "predict_additive_with_sidecar",
        json!({ "payload": payload, "prediction": "mock" }),
    )
}
