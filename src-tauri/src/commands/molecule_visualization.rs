use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub fn visualize_molecule_from_smiles(smiles: String) -> Result<Value, String> {
    ok(
        "visualize_molecule_from_smiles",
        json!({ "smiles": smiles, "svg": "<svg />", "mode": "mock" }),
    )
}

#[tauri::command]
pub async fn generate_molecule_3d(app: AppHandle, smiles: String) -> Result<Value, String> {
    run_sidecar_command(
        &app,
        "generate-3d",
        json!({ "smiles": smiles, "add_hydrogens": true, "optimize": true, "force_field": "MMFF" }),
    )
    .await
}

#[tauri::command]
pub fn convert_molecule_format(
    input_text: String,
    input_format: String,
    output_format: String,
) -> Result<Value, String> {
    ok(
        "convert_molecule_format",
        json!({ "input_format": input_format, "output_format": output_format, "content": input_text }),
    )
}

#[tauri::command]
pub fn export_molecule_file(
    content: String,
    output_format: String,
    save_path: String,
) -> Result<Value, String> {
    ok(
        "export_molecule_file",
        json!({ "output_format": output_format, "save_path": save_path, "bytes": content.len() }),
    )
}
