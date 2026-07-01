use crate::app_paths::default_database_path;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOilDto {
    pub id: String,
    pub name: String,
    pub base_oil_type: String,
    pub representative_molecule_id: String,
    pub viscosity_40c: Option<f64>,
    pub viscosity_100c: Option<f64>,
    pub viscosity_index: Option<f64>,
    pub density: Option<f64>,
    pub pour_point: Option<f64>,
    pub flash_point: Option<f64>,
    pub supplier: String,
    pub batch_number: String,
    pub formulation_count: i64,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdditiveDto {
    pub id: String,
    pub molecule_id: String,
    pub molecule_name: String,
    pub function_types: Vec<String>,
    pub active_elements: Vec<String>,
    pub typical_concentration_min: f64,
    pub typical_concentration_max: f64,
    pub concentration_unit: String,
    pub compatible_base_oils: Vec<String>,
    pub formulation_count: i64,
    pub best_friction_coefficient: Option<f64>,
    pub best_wear_scar_diameter: Option<f64>,
    pub application_notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_base_oil(app: AppHandle, payload: Value) -> Result<BaseOilDto, String> {
    let name =
        field_string(&payload, "name").ok_or_else(|| "Base oil name is required.".to_string())?;
    let id = field_string(&payload, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    connection
        .execute(
            "INSERT INTO base_oils (
                id, name, base_oil_type, representative_molecule_id, viscosity_40c,
                viscosity_100c, viscosity_index, density, pour_point, flash_point,
                supplier, batch_number, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
            params![
                &id,
                &name,
                field_string(&payload, "baseOilType")
                    .or_else(|| field_string(&payload, "base_oil_type")),
                field_string(&payload, "representativeMoleculeId")
                    .or_else(|| field_string(&payload, "representative_molecule_id")),
                field_f64(&payload, "viscosity40c")
                    .or_else(|| field_f64(&payload, "viscosity_40c")),
                field_f64(&payload, "viscosity100c")
                    .or_else(|| field_f64(&payload, "viscosity_100c")),
                field_f64(&payload, "viscosityIndex")
                    .or_else(|| field_f64(&payload, "viscosity_index")),
                field_f64(&payload, "density"),
                field_f64(&payload, "pourPoint").or_else(|| field_f64(&payload, "pour_point")),
                field_f64(&payload, "flashPoint").or_else(|| field_f64(&payload, "flash_point")),
                field_string(&payload, "supplier").unwrap_or_default(),
                field_string(&payload, "batchNumber")
                    .or_else(|| field_string(&payload, "batch_number"))
                    .unwrap_or_default(),
                field_string(&payload, "notes").unwrap_or_default(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to create base oil: {err}"))?;
    get_base_oil(&connection, &id)
}

#[tauri::command]
pub fn list_base_oils(app: AppHandle, _filter: Option<Value>) -> Result<Vec<BaseOilDto>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, base_oil_type, representative_molecule_id, viscosity_40c,
                    viscosity_100c, viscosity_index, density, pour_point, flash_point,
                    supplier, batch_number, notes, created_at, updated_at
             FROM base_oils
             ORDER BY datetime(created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare base oil list query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let formulation_count =
                count_formulation_components(&connection, "base_oil_id = ?1", params![&id])?;
            Ok(BaseOilDto {
                id,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                base_oil_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                representative_molecule_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                viscosity_40c: row.get(4)?,
                viscosity_100c: row.get(5)?,
                viscosity_index: row.get(6)?,
                density: row.get(7)?,
                pour_point: row.get(8)?,
                flash_point: row.get(9)?,
                supplier: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                batch_number: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                formulation_count,
                notes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|err| format!("Failed to query base oils: {err}"))?;
    collect_rows(rows, "base oil")
}

#[tauri::command]
pub fn delete_base_oil(app: AppHandle, id: String) -> Result<Value, String> {
    let mut connection = open_connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start base oil delete transaction: {err}"))?;
    transaction
        .execute(
            "DELETE FROM formulation_components WHERE base_oil_id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete base oil formulation components: {err}"))?;
    let deleted = transaction
        .execute("DELETE FROM base_oils WHERE id = ?1", params![&id])
        .map_err(|err| format!("Failed to delete base oil: {err}"))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit base oil delete transaction: {err}"))?;
    Ok(json!({ "success": deleted > 0, "deleted": deleted > 0, "id": id }))
}

#[tauri::command]
pub fn create_additive(app: AppHandle, payload: Value) -> Result<AdditiveDto, String> {
    let molecule_id = field_string(&payload, "moleculeId")
        .or_else(|| field_string(&payload, "molecule_id"))
        .ok_or_else(|| "A representative molecule is required for additive records.".to_string())?;
    let id = field_string(&payload, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    let molecule_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM molecules WHERE id = ?1)",
            params![&molecule_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to validate additive molecule: {err}"))?;
    if !molecule_exists {
        return Err(format!(
            "Representative molecule does not exist: {molecule_id}"
        ));
    }
    connection
        .execute(
            "INSERT INTO additives (
                id, molecule_id, function_types, active_elements, typical_concentration_min,
                typical_concentration_max, concentration_unit, compatible_base_oils, application_notes,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                &id,
                &molecule_id,
                list_json(&payload, "functionTypes").or_else(|| list_json(&payload, "function_types")),
                list_json(&payload, "activeElements").or_else(|| list_json(&payload, "active_elements")),
                field_f64(&payload, "typicalConcentrationMin")
                    .or_else(|| field_f64(&payload, "typical_concentration_min"))
                    .unwrap_or_default(),
                field_f64(&payload, "typicalConcentrationMax")
                    .or_else(|| field_f64(&payload, "typical_concentration_max"))
                    .unwrap_or_default(),
                field_string(&payload, "concentrationUnit")
                    .or_else(|| field_string(&payload, "concentration_unit"))
                    .unwrap_or_else(|| "wt%".to_string()),
                list_json(&payload, "compatibleBaseOils").or_else(|| list_json(&payload, "compatible_base_oils")),
                field_string(&payload, "applicationNotes")
                    .or_else(|| field_string(&payload, "application_notes"))
                    .unwrap_or_default(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to create additive: {err}"))?;
    get_additive(&connection, &id)
}

#[tauri::command]
pub fn list_additives(app: AppHandle, _filter: Option<Value>) -> Result<Vec<AdditiveDto>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT a.id, a.molecule_id, COALESCE(m.name, ''), a.function_types, a.active_elements,
                    a.typical_concentration_min, a.typical_concentration_max, a.concentration_unit,
                    a.compatible_base_oils, a.application_notes, a.created_at, a.updated_at
             FROM additives a
             LEFT JOIN molecules m ON m.id = a.molecule_id
             ORDER BY datetime(a.created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare additive list query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let (best_friction_coefficient, best_wear_scar_diameter) =
                best_additive_performance(&connection, &id)?;
            Ok(AdditiveDto {
                id: id.clone(),
                molecule_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                molecule_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                function_types: parse_string_list(
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ),
                active_elements: parse_string_list(
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ),
                typical_concentration_min: row.get::<_, Option<f64>>(5)?.unwrap_or_default(),
                typical_concentration_max: row.get::<_, Option<f64>>(6)?.unwrap_or_default(),
                concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                compatible_base_oils: parse_string_list(
                    row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                ),
                formulation_count: count_formulation_components(
                    &connection,
                    "additive_id = ?1",
                    params![&id],
                )?,
                best_friction_coefficient,
                best_wear_scar_diameter,
                application_notes: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|err| format!("Failed to query additives: {err}"))?;
    collect_rows(rows, "additive")
}

#[tauri::command]
pub fn delete_additive(app: AppHandle, id: String) -> Result<Value, String> {
    let mut connection = open_connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start additive delete transaction: {err}"))?;
    transaction
        .execute(
            "DELETE FROM formulation_components WHERE additive_id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete additive formulation components: {err}"))?;
    let deleted = transaction
        .execute("DELETE FROM additives WHERE id = ?1", params![&id])
        .map_err(|err| format!("Failed to delete additive: {err}"))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit additive delete transaction: {err}"))?;
    Ok(json!({ "success": deleted > 0, "deleted": deleted > 0, "id": id }))
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn get_base_oil(connection: &Connection, id: &str) -> Result<BaseOilDto, String> {
    connection
        .query_row(
            "SELECT id, name, base_oil_type, representative_molecule_id, viscosity_40c,
                    viscosity_100c, viscosity_index, density, pour_point, flash_point,
                    supplier, batch_number, notes, created_at, updated_at
             FROM base_oils
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(BaseOilDto {
                    id: row.get(0)?,
                    name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    base_oil_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    representative_molecule_id: row
                        .get::<_, Option<String>>(3)?
                        .unwrap_or_default(),
                    viscosity_40c: row.get(4)?,
                    viscosity_100c: row.get(5)?,
                    viscosity_index: row.get(6)?,
                    density: row.get(7)?,
                    pour_point: row.get(8)?,
                    flash_point: row.get(9)?,
                    supplier: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    batch_number: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                    formulation_count: 0,
                    notes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load created base oil: {err}"))
}

fn get_additive(connection: &Connection, id: &str) -> Result<AdditiveDto, String> {
    connection
        .query_row(
            "SELECT a.id, a.molecule_id, COALESCE(m.name, ''), a.function_types, a.active_elements,
                    a.typical_concentration_min, a.typical_concentration_max, a.concentration_unit,
                    a.compatible_base_oils, a.application_notes, a.created_at, a.updated_at
             FROM additives a
             LEFT JOIN molecules m ON m.id = a.molecule_id
             WHERE a.id = ?1",
            params![id],
            |row| {
                Ok(AdditiveDto {
                    id: row.get(0)?,
                    molecule_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    molecule_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    function_types: parse_string_list(
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    ),
                    active_elements: parse_string_list(
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    ),
                    typical_concentration_min: row.get::<_, Option<f64>>(5)?.unwrap_or_default(),
                    typical_concentration_max: row.get::<_, Option<f64>>(6)?.unwrap_or_default(),
                    concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    compatible_base_oils: parse_string_list(
                        row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    ),
                    formulation_count: 0,
                    best_friction_coefficient: None,
                    best_wear_scar_diameter: None,
                    application_notes: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load created additive: {err}"))
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
    label: &str,
) -> Result<Vec<T>, String> {
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read {label} row: {err}"))?);
    }
    Ok(items)
}

fn count_formulation_components(
    connection: &Connection,
    condition: &str,
    params: impl rusqlite::Params,
) -> rusqlite::Result<i64> {
    let sql = format!(
        "SELECT COUNT(DISTINCT formulation_id) FROM formulation_components WHERE {condition}"
    );
    connection.query_row(&sql, params, |row| row.get(0))
}

fn best_additive_performance(
    connection: &Connection,
    additive_id: &str,
) -> rusqlite::Result<(Option<f64>, Option<f64>)> {
    connection.query_row(
        "SELECT MIN(pr.average_friction_coefficient), MIN(pr.wear_scar_diameter_value)
         FROM formulation_components fc
         JOIN experiments e ON e.formulation_id = fc.formulation_id
         JOIN performance_results pr ON pr.experiment_id = e.id
         WHERE fc.additive_id = ?1",
        params![additive_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

fn parse_string_list(value: String) -> Vec<String> {
    if value.trim().is_empty() {
        return Vec::new();
    }
    if let Ok(items) = serde_json::from_str::<Vec<String>>(&value) {
        return items;
    }
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn field_string(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(|value| match value {
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
}

fn field_f64(payload: &Value, key: &str) -> Option<f64> {
    payload.get(key).and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    })
}

fn list_json(payload: &Value, key: &str) -> Option<String> {
    let value = payload.get(key)?;
    let items = match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        Value::String(text) => text
            .split([';', ',', '|'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    serde_json::to_string(&items).ok()
}
