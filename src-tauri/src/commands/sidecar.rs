use crate::app_paths::default_database_path;
use crate::commands::ok;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
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
pub async fn import_excel_with_sidecar(app: AppHandle, file_path: String) -> Result<Value, String> {
    let mut result = run_sidecar_command(
        &app,
        "import-excel",
        json!({ "file_path": &file_path, "preview_rows": 20 }),
    )
    .await?;
    let import_summary = import_preview_rows(&app, &file_path, &result)?;
    if let Some(data) = result.get_mut("data").and_then(Value::as_object_mut) {
        data.insert(
            "import_kind".to_string(),
            Value::String(import_summary.import_kind),
        );
        data.insert(
            "imported_count".to_string(),
            Value::Number(import_summary.imported_count.into()),
        );
        data.insert(
            "skipped_count".to_string(),
            Value::Number(import_summary.skipped_count.into()),
        );
        data.insert(
            "created_molecule_count".to_string(),
            Value::Number(import_summary.created_molecule_count.into()),
        );
        data.insert(
            "warnings".to_string(),
            Value::Array(import_summary.warnings.into_iter().map(Value::String).collect()),
        );
    }
    Ok(result)
}

#[tauri::command]
pub fn predict_additive_with_sidecar(payload: Value) -> Result<Value, String> {
    ok(
        "predict_additive_with_sidecar",
        json!({ "payload": payload, "prediction": "mock" }),
    )
}

#[derive(Default)]
struct ImportSummary {
    import_kind: String,
    imported_count: i64,
    skipped_count: i64,
    created_molecule_count: i64,
    warnings: Vec<String>,
}

fn import_preview_rows(
    app: &AppHandle,
    file_path: &str,
    sidecar_result: &Value,
) -> Result<ImportSummary, String> {
    let data = sidecar_result
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| "Sidecar import result did not include data.".to_string())?;
    let rows = data
        .get("preview_rows")
        .or_else(|| data.get("rows"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let columns = data
        .get("columns")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|item| item.to_ascii_lowercase())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let import_kind = detect_import_kind(&columns, &rows);
    if import_kind == "preview_only" {
        return Ok(ImportSummary {
            import_kind,
            skipped_count: rows.len() as i64,
            ..ImportSummary::default()
        });
    }

    let mut connection = Connection::open(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database for import: {err}"))?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start import transaction: {err}"))?;
    let mut summary = ImportSummary {
        import_kind: import_kind.clone(),
        ..ImportSummary::default()
    };

    for row in rows {
        let Some(row) = row.as_object() else {
            summary.skipped_count += 1;
            continue;
        };
        let imported = if import_kind == "base_oils" {
            import_base_oil_row(&tx, row, file_path, &mut summary)
        } else {
            import_additive_row(&tx, row, file_path, &mut summary)
        };
        if let Err(err) = imported {
            summary.skipped_count += 1;
            summary.warnings.push(err);
        }
    }

    tx.commit()
        .map_err(|err| format!("Failed to commit import transaction: {err}"))?;
    Ok(summary)
}

fn detect_import_kind(columns: &[String], rows: &[Value]) -> String {
    let has = |key: &str| columns.iter().any(|column| column == key);
    if has("base_oil_type") || has("viscosity_40c") || has("viscosity_100c") {
        return "base_oils".to_string();
    }
    if has("function_types")
        || has("active_elements")
        || has("typical_concentration_min")
        || has("compatible_base_oils")
    {
        return "additives".to_string();
    }
    if rows.iter().any(|row| {
        row.as_object()
            .and_then(|object| field_string(object, &["record_type", "type", "kind"]))
            .map(|value| matches!(value.as_str(), "base_oil" | "base_oils"))
            .unwrap_or(false)
    }) {
        return "base_oils".to_string();
    }
    if rows.iter().any(|row| {
        row.as_object()
            .and_then(|object| field_string(object, &["record_type", "type", "kind"]))
            .map(|value| matches!(value.as_str(), "additive" | "additives"))
            .unwrap_or(false)
    }) {
        return "additives".to_string();
    }
    "preview_only".to_string()
}

fn import_base_oil_row(
    tx: &rusqlite::Transaction<'_>,
    row: &serde_json::Map<String, Value>,
    file_path: &str,
    summary: &mut ImportSummary,
) -> Result<(), String> {
    let name = field_string(row, &["name", "base_oil_name"])
        .ok_or_else(|| "Skipped base oil row without name.".to_string())?;
    let id = field_string(row, &["id", "base_oil_id"]).unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO base_oils (
            id, name, base_oil_type, representative_molecule_id, viscosity_40c,
            viscosity_100c, viscosity_index, density, pour_point, flash_point,
            supplier, batch_number, notes, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            base_oil_type = excluded.base_oil_type,
            representative_molecule_id = excluded.representative_molecule_id,
            viscosity_40c = excluded.viscosity_40c,
            viscosity_100c = excluded.viscosity_100c,
            viscosity_index = excluded.viscosity_index,
            density = excluded.density,
            pour_point = excluded.pour_point,
            flash_point = excluded.flash_point,
            supplier = excluded.supplier,
            batch_number = excluded.batch_number,
            notes = excluded.notes,
            updated_at = excluded.updated_at",
        params![
            &id,
            &name,
            field_string(row, &["base_oil_type", "type"]),
            field_string(row, &["representative_molecule_id", "molecule_id"]),
            field_f64(row, &["viscosity_40c", "kv40"]),
            field_f64(row, &["viscosity_100c", "kv100"]),
            field_f64(row, &["viscosity_index", "vi"]),
            field_f64(row, &["density"]),
            field_f64(row, &["pour_point"]),
            field_f64(row, &["flash_point"]),
            field_string(row, &["supplier"]),
            field_string(row, &["batch_number", "batch"]),
            field_string(row, &["notes"]).unwrap_or_else(|| format!("Imported from {file_path}")),
            now,
        ],
    )
    .map_err(|err| format!("Failed to import base oil {id}: {err}"))?;
    summary.imported_count += 1;
    Ok(())
}

fn import_additive_row(
    tx: &rusqlite::Transaction<'_>,
    row: &serde_json::Map<String, Value>,
    file_path: &str,
    summary: &mut ImportSummary,
) -> Result<(), String> {
    let additive_id = field_string(row, &["id", "additive_id"]).unwrap_or_else(|| Uuid::new_v4().to_string());
    let molecule_id = ensure_additive_molecule(tx, row, file_path, &additive_id, summary)?;
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO additives (
            id, molecule_id, function_types, active_elements, typical_concentration_min,
            typical_concentration_max, concentration_unit, compatible_base_oils, application_notes,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(id) DO UPDATE SET
            molecule_id = excluded.molecule_id,
            function_types = excluded.function_types,
            active_elements = excluded.active_elements,
            typical_concentration_min = excluded.typical_concentration_min,
            typical_concentration_max = excluded.typical_concentration_max,
            concentration_unit = excluded.concentration_unit,
            compatible_base_oils = excluded.compatible_base_oils,
            application_notes = excluded.application_notes,
            updated_at = excluded.updated_at",
        params![
            &additive_id,
            &molecule_id,
            list_json(row, &["function_types", "additive_function_tags", "functions"]),
            list_json(row, &["active_elements", "elements"]),
            field_f64(row, &["typical_concentration_min", "concentration_min"]),
            field_f64(row, &["typical_concentration_max", "concentration_max"]),
            field_string(row, &["concentration_unit"]).unwrap_or_else(|| "wt%".to_string()),
            list_json(row, &["compatible_base_oils", "compatible_base_oil"]),
            field_string(row, &["application_notes", "notes"]).unwrap_or_else(|| format!("Imported from {file_path}")),
            now,
        ],
    )
    .map_err(|err| format!("Failed to import additive {additive_id}: {err}"))?;
    summary.imported_count += 1;
    Ok(())
}

fn ensure_additive_molecule(
    tx: &rusqlite::Transaction<'_>,
    row: &serde_json::Map<String, Value>,
    file_path: &str,
    additive_id: &str,
    summary: &mut ImportSummary,
) -> Result<String, String> {
    if let Some(molecule_id) = field_string(row, &["molecule_id"]) {
        let exists = tx
            .query_row(
                "SELECT id FROM molecules WHERE id = ?1",
                params![&molecule_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| format!("Failed to inspect molecule {molecule_id}: {err}"))?
            .is_some();
        if exists {
            return Ok(molecule_id);
        }
        create_minimal_molecule(tx, row, file_path, Some(molecule_id), summary)
    } else {
        create_minimal_molecule(tx, row, file_path, Some(format!("mol-{additive_id}")), summary)
    }
}

fn create_minimal_molecule(
    tx: &rusqlite::Transaction<'_>,
    row: &serde_json::Map<String, Value>,
    file_path: &str,
    molecule_id: Option<String>,
    summary: &mut ImportSummary,
) -> Result<String, String> {
    let smiles = field_string(row, &["smiles", "smiles_canonical"]).unwrap_or_default();
    let name = field_string(row, &["molecule_name", "name"])
        .or_else(|| if smiles.is_empty() { None } else { Some(smiles.clone()) })
        .ok_or_else(|| "Skipped additive row without molecule_id, molecule_name, or smiles.".to_string())?;
    let id = molecule_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT OR IGNORE INTO molecules (
            id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
            category, tags, molfile, descriptor_json, duplicate_of, import_mode, source,
            structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
            rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?4, '', '', ?5, ?6, 'additive', ?7, '', '{}', '', 'csv_import', ?8,
                   '', '', '', '', 'pending', 'pending', 0, ?8, ?9, ?10, ?10)",
        params![
            &id,
            &name,
            field_string(row, &["aliases"]).unwrap_or_default(),
            &smiles,
            field_string(row, &["formula"]).unwrap_or_default(),
            field_f64(row, &["molecular_weight"]).unwrap_or_default(),
            list_json(row, &["function_types", "additive_function_tags", "functions"]),
            file_path,
            field_string(row, &["application_notes", "notes"]).unwrap_or_else(|| format!("Imported from {file_path}")),
            now,
        ],
    )
    .map_err(|err| format!("Failed to create additive molecule {id}: {err}"))?;
    if tx.changes() > 0 {
        summary.created_molecule_count += 1;
    }
    Ok(id)
}

fn field_string(row: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        row.get(*key).and_then(|value| match value {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
    })
}

fn field_f64(row: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        row.get(*key).and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        })
    })
}

fn list_json(row: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    let items = keys
        .iter()
        .find_map(|key| row.get(*key))
        .map(parse_list_value)
        .unwrap_or_default();
    serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string())
}

fn parse_list_value(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| field_value_to_string(item))
            .collect(),
        _ => field_value_to_string(value)
            .map(|text| {
                text.split([';', ',', '|'])
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn field_value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}
