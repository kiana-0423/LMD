use crate::app_paths::default_database_path;
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleculeDescriptorDto {
    pub id: String,
    pub molecule_id: String,
    pub descriptor_set: String,
    pub descriptor_version: String,
    pub descriptors_json: Value,
    pub descriptor_count: i64,
    pub status: String,
    pub mode: String,
    pub error_message: String,
    pub calculated_at: String,
}

#[tauri::command]
pub fn calculate_rdkit_descriptors(molecule_id: String) -> Result<Value, String> {
    ok(
        "calculate_rdkit_descriptors",
        json!({ "molecule_id": molecule_id, "todo": "Call sidecar by molecule SMILES in phase 2." }),
    )
}

#[tauri::command]
pub fn calculate_mordred_descriptors(molecule_id: String) -> Result<Value, String> {
    ok(
        "calculate_mordred_descriptors",
        json!({ "molecule_id": molecule_id, "todo": "Call sidecar by molecule SMILES in phase 2." }),
    )
}

#[tauri::command]
pub async fn calculate_required_descriptors(
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
pub fn batch_calculate_descriptors(
    molecule_ids: Vec<String>,
    descriptor_sets: Vec<String>,
) -> Result<Value, String> {
    ok(
        "batch_calculate_descriptors",
        json!({ "molecule_ids": molecule_ids, "descriptor_sets": descriptor_sets, "status": "queued_mock" }),
    )
}

#[tauri::command]
pub fn recalculate_failed_descriptors() -> Result<Value, String> {
    ok(
        "recalculate_failed_descriptors",
        json!({ "status": "queued_mock" }),
    )
}

#[tauri::command]
pub fn recalculate_all_descriptors() -> Result<Value, String> {
    ok(
        "recalculate_all_descriptors",
        json!({ "status": "queued_mock" }),
    )
}

#[tauri::command]
pub fn list_descriptor_jobs() -> Result<Value, String> {
    ok("list_descriptor_jobs", json!({ "items": [] }))
}

#[tauri::command]
pub fn list_molecule_descriptors(
    app: AppHandle,
    molecule_id: Option<String>,
) -> Result<Vec<MoleculeDescriptorDto>, String> {
    let conn = open_connection(&app)?;
    let (sql, params_vec): (&str, Vec<String>) = if let Some(id) = molecule_id {
        (
            "SELECT id, molecule_id, descriptor_set, descriptor_version, descriptors_json,
                    descriptor_count, status, mode, error_message, calculated_at
             FROM molecule_descriptors
             WHERE molecule_id = ?1
             ORDER BY descriptor_set",
            vec![id],
        )
    } else {
        (
            "SELECT id, molecule_id, descriptor_set, descriptor_version, descriptors_json,
                    descriptor_count, status, mode, error_message, calculated_at
             FROM molecule_descriptors
             ORDER BY calculated_at DESC",
            vec![],
        )
    };
    let mut statement = conn
        .prepare(sql)
        .map_err(|err| format!("Failed to prepare descriptor query: {err}"))?;
    let rows = if params_vec.is_empty() {
        statement
            .query_map([], descriptor_from_row)
            .map_err(|err| format!("Failed to query descriptors: {err}"))?
            .collect::<Result<Vec<_>, _>>()
    } else {
        statement
            .query_map(params![&params_vec[0]], descriptor_from_row)
            .map_err(|err| format!("Failed to query descriptors: {err}"))?
            .collect::<Result<Vec<_>, _>>()
    }
    .map_err(|err| format!("Failed to read descriptor row: {err}"))?;
    Ok(rows)
}

#[tauri::command]
pub fn get_descriptor_status(app: AppHandle, molecule_id: String) -> Result<Value, String> {
    let descriptors = list_molecule_descriptors(app, Some(molecule_id.clone()))?;
    let rdkit = descriptors
        .iter()
        .find(|item| item.descriptor_set == "rdkit")
        .map(|item| item.status.clone())
        .unwrap_or_else(|| "missing".to_string());
    let mordred = descriptors
        .iter()
        .find(|item| item.descriptor_set == "mordred")
        .map(|item| item.status.clone())
        .unwrap_or_else(|| "missing".to_string());
    ok(
        "get_descriptor_status",
        json!({ "molecule_id": molecule_id, "rdkit": rdkit, "mordred": mordred }),
    )
}

#[tauri::command]
pub fn get_descriptor_summary(app: AppHandle, molecule_id: String) -> Result<Value, String> {
    let descriptors = list_molecule_descriptors(app, Some(molecule_id.clone()))?;
    let summary_keys = [
        "MolWt",
        "MolLogP",
        "TPSA",
        "NumHDonors",
        "NumHAcceptors",
        "NumRotatableBonds",
        "RingCount",
        "HeavyAtomCount",
        "NumHeteroatoms",
        "Element_C",
        "Element_H",
        "Element_O",
        "Element_N",
        "Element_S",
        "Element_P",
    ];
    let mut summary = serde_json::Map::new();
    for descriptor in descriptors {
        if let Some(object) = descriptor.descriptors_json.as_object() {
            for key in summary_keys {
                if let Some(value) = object.get(key) {
                    summary.insert(key.to_string(), value.clone());
                }
            }
        }
    }
    ok(
        "get_descriptor_summary",
        json!({ "molecule_id": molecule_id, "summary": summary }),
    )
}

#[tauri::command]
pub fn get_descriptor_json(
    app: AppHandle,
    molecule_id: String,
    descriptor_set: String,
) -> Result<Option<MoleculeDescriptorDto>, String> {
    let conn = open_connection(&app)?;
    conn.query_row(
        "SELECT id, molecule_id, descriptor_set, descriptor_version, descriptors_json,
                descriptor_count, status, mode, error_message, calculated_at
         FROM molecule_descriptors
         WHERE molecule_id = ?1 AND descriptor_set = ?2",
        params![molecule_id, descriptor_set],
        |row| descriptor_from_row(row),
    )
    .optional()
    .map_err(|err| format!("Failed to get descriptor JSON: {err}"))
}

#[tauri::command]
pub fn export_all_descriptors_csv(save_path: String) -> Result<Value, String> {
    ok(
        "export_all_descriptors_csv",
        json!({ "save_path": save_path, "todo": "Expand descriptors_json from SQLite to CSV in the export phase." }),
    )
}

#[tauri::command]
pub fn export_ml_descriptor_matrix_csv(save_path: String, options: Value) -> Result<Value, String> {
    ok(
        "export_ml_descriptor_matrix_csv",
        json!({ "save_path": save_path, "options": options, "todo": "Expand descriptors_json from SQLite to ML matrix CSV in the export phase." }),
    )
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn descriptor_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MoleculeDescriptorDto> {
    let descriptors_json_text: String = row.get(4)?;
    let descriptors_json =
        serde_json::from_str(&descriptors_json_text).unwrap_or_else(|_| json!({}));
    Ok(MoleculeDescriptorDto {
        id: row.get(0)?,
        molecule_id: row.get(1)?,
        descriptor_set: row.get(2)?,
        descriptor_version: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        descriptors_json,
        descriptor_count: row.get::<_, Option<i64>>(5)?.unwrap_or_default(),
        status: row.get(6)?,
        mode: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        error_message: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        calculated_at: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
    })
}
