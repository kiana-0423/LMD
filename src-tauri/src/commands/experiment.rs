use crate::app_paths::default_database_path;
use crate::commands::ok;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDto {
    pub id: String,
    pub formulation_id: String,
    pub formulation_name: String,
    pub test_type: String,
    pub test_standard: String,
    pub instrument: String,
    pub upper_material: String,
    pub lower_material: String,
    pub load_value: Option<f64>,
    pub load_unit: String,
    pub temperature_value: Option<f64>,
    pub temperature_unit: String,
    pub duration_value: Option<f64>,
    pub duration_unit: String,
    pub operator: String,
    pub experiment_date: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResultDto {
    pub id: String,
    pub experiment_id: String,
    pub average_friction_coefficient: Option<f64>,
    pub stable_friction_coefficient: Option<f64>,
    pub wear_scar_width_value: Option<f64>,
    pub wear_scar_diameter_value: Option<f64>,
    pub initial_oxidation_temperature_value: Option<f64>,
    pub extreme_pressure_value: Option<f64>,
    pub pb_value: Option<f64>,
    pub pd_value: Option<f64>,
    pub viscosity_40c: Option<f64>,
    pub viscosity_100c: Option<f64>,
    pub repeat_count: Option<i64>,
    pub std_json: Value,
    pub raw_result_json: Value,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_experiment(payload: Value) -> Result<Value, String> {
    ok(
        "create_experiment",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_experiments(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<ExperimentDto>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT e.id, e.formulation_id, COALESCE(f.name, ''), e.test_type, e.test_standard,
                    e.instrument, e.upper_material, e.lower_material, e.load_value, e.load_unit,
                    e.temperature_value, e.temperature_unit, e.duration_value, e.duration_unit,
                    e.operator, e.experiment_date, e.notes, e.created_at, e.updated_at
             FROM experiments e
             LEFT JOIN formulations f ON f.id = e.formulation_id
             ORDER BY datetime(e.created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare experiment list query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ExperimentDto {
                id: row.get(0)?,
                formulation_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                formulation_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                test_type: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                test_standard: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                instrument: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                upper_material: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                lower_material: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                load_value: row.get(8)?,
                load_unit: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                temperature_value: row.get(10)?,
                temperature_unit: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                duration_value: row.get(12)?,
                duration_unit: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                operator: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
                experiment_date: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                notes: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })
        .map_err(|err| format!("Failed to query experiments: {err}"))?;
    collect_rows(rows, "experiment")
}

#[tauri::command]
pub fn create_performance_result(payload: Value) -> Result<Value, String> {
    ok(
        "create_performance_result",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn list_performance_results(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<PerformanceResultDto>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, experiment_id, average_friction_coefficient, stable_friction_coefficient,
                    wear_scar_width_value, wear_scar_diameter_value,
                    initial_oxidation_temperature_value, extreme_pressure_value, pb_value, pd_value,
                    viscosity_40c, viscosity_100c, repeat_count, std_json, raw_result_json,
                    notes, created_at, updated_at
             FROM performance_results
             ORDER BY datetime(created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare performance result list query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(PerformanceResultDto {
                id: row.get(0)?,
                experiment_id: row.get(1)?,
                average_friction_coefficient: row.get(2)?,
                stable_friction_coefficient: row.get(3)?,
                wear_scar_width_value: row.get(4)?,
                wear_scar_diameter_value: row.get(5)?,
                initial_oxidation_temperature_value: row.get(6)?,
                extreme_pressure_value: row.get(7)?,
                pb_value: row.get(8)?,
                pd_value: row.get(9)?,
                viscosity_40c: row.get(10)?,
                viscosity_100c: row.get(11)?,
                repeat_count: row.get(12)?,
                std_json: parse_json_text(row.get::<_, Option<String>>(13)?.unwrap_or_default()),
                raw_result_json: parse_json_text(
                    row.get::<_, Option<String>>(14)?.unwrap_or_default(),
                ),
                notes: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(|err| format!("Failed to query performance results: {err}"))?;
    collect_rows(rows, "performance result")
}

#[tauri::command]
pub fn get_experiment_with_results(app: AppHandle, id: String) -> Result<Value, String> {
    let experiments = list_experiments(app.clone(), None)?;
    let results = list_performance_results(app, None)?
        .into_iter()
        .filter(|result| result.experiment_id == id)
        .collect::<Vec<_>>();
    let experiment = experiments.into_iter().find(|item| item.id == id);
    ok(
        "get_experiment_with_results",
        json!({ "experiment": experiment, "results": results }),
    )
}

#[tauri::command]
pub fn add_attachment(payload: Value) -> Result<Value, String> {
    ok(
        "add_attachment",
        json!({ "id": Uuid::new_v4(), "payload": payload, "relative_path_required": true }),
    )
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
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

fn parse_json_text(value: String) -> Value {
    if value.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str(&value).unwrap_or_else(|_| json!({}))
}
