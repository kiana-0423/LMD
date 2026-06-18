use crate::commands::ok;
use serde_json::{json, Value};
use std::fs;
use std::process::Command;
use uuid::Uuid;

pub fn run_sidecar_command(command_name: &str, input: Value) -> Result<Value, String> {
    let sidecar_dir = sidecar_dir()?;
    let input_path = std::env::temp_dir().join(format!("lmd-sidecar-{}.json", Uuid::new_v4()));
    fs::write(
        &input_path,
        serde_json::to_vec(&input)
            .map_err(|err| format!("Failed to serialize sidecar input: {err}"))?,
    )
    .map_err(|err| format!("Failed to write sidecar input file: {err}"))?;

    let output = run_python(&sidecar_dir, command_name, &input_path).map_err(|err| {
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

fn run_python(
    sidecar_dir: &std::path::Path,
    command_name: &str,
    input_path: &std::path::Path,
) -> Result<std::process::Output, String> {
    let args = [
        "-m",
        "lmd_sidecar.main",
        command_name,
        "--input",
        input_path
            .to_str()
            .ok_or_else(|| "Sidecar input path is not valid UTF-8".to_string())?,
    ];
    for executable in ["python3", "python"] {
        match Command::new(executable)
            .args(args)
            .current_dir(sidecar_dir)
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    return Ok(output);
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                return Err(format!(
                    "Python sidecar command {command_name} failed via {executable}. stderr: {stderr}. stdout: {stdout}"
                ));
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                return Err(format!(
                    "Failed to launch Python sidecar via {executable}: {err}"
                ))
            }
        }
    }
    Err(
        "Python executable not found. Install python3 or configure the packaged sidecar."
            .to_string(),
    )
}

fn sidecar_dir() -> Result<std::path::PathBuf, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_path = manifest_dir.join("../python-sidecar");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    std::env::current_exe()
        .map_err(|err| format!("Failed to resolve current executable: {err}"))?
        .parent()
        .map(|path| path.join("python-sidecar"))
        .ok_or_else(|| "Failed to resolve packaged sidecar directory".to_string())
}

#[tauri::command]
pub fn standardize_molecule_with_sidecar(smiles: String) -> Result<Value, String> {
    run_sidecar_command("standardize", json!({ "smiles": smiles }))
}

#[tauri::command]
pub fn calculate_descriptors_with_sidecar(
    smiles: String,
    descriptor_set: String,
) -> Result<Value, String> {
    let command_name = match descriptor_set.as_str() {
        "rdkit" => "rdkit-descriptors",
        "mordred" => "mordred-descriptors",
        other => return Err(format!("Unsupported descriptor_set: {other}")),
    };
    run_sidecar_command(
        command_name,
        json!({ "smiles": smiles, "allow_mock": true }),
    )
}

#[tauri::command]
pub fn calculate_required_descriptors_with_sidecar(
    smiles: String,
    allow_mock: bool,
) -> Result<Value, String> {
    run_sidecar_command(
        "calculate-required-descriptors",
        json!({
            "smiles": smiles,
            "require_rdkit": true,
            "require_mordred": true,
            "allow_mock": allow_mock
        }),
    )
}

#[tauri::command]
pub fn validate_smiles_with_sidecar(smiles: String) -> Result<Value, String> {
    run_sidecar_command("validate-smiles", json!({ "smiles": smiles }))
}

#[tauri::command]
pub fn molfile_to_smiles_with_sidecar(molfile: String) -> Result<Value, String> {
    run_sidecar_command("molfile-to-smiles", json!({ "molfile": molfile }))
}

#[tauri::command]
pub fn smiles_to_molfile_with_sidecar(smiles: String) -> Result<Value, String> {
    run_sidecar_command("smiles-to-molfile", json!({ "smiles": smiles }))
}

#[tauri::command]
pub fn calculate_sketcher_descriptors_with_sidecar(
    smiles: String,
    allow_mock: bool,
) -> Result<Value, String> {
    run_sidecar_command(
        "calculate-sketcher-descriptors",
        json!({ "smiles": smiles, "allow_mock": allow_mock }),
    )
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
