use crate::app_paths::default_database_path;
use crate::commands::ok;
use chrono::Utc;
use rusqlite::{params, Connection};
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
pub fn create_experiment(app: AppHandle, payload: Value) -> Result<ExperimentDto, String> {
    let formulation_id = field_string(&payload, "formulationId")
        .or_else(|| field_string(&payload, "formulation_id"))
        .ok_or_else(|| "Formulation is required for experiment records.".to_string())?;
    let id = field_string(&payload, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    let formulation_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM formulations WHERE id = ?1)",
            params![&formulation_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to validate experiment formulation: {err}"))?;
    if !formulation_exists {
        return Err(format!("Formulation does not exist: {formulation_id}"));
    }
    connection
        .execute(
            "INSERT INTO experiments (
                id, formulation_id, test_type, test_standard, instrument, upper_material,
                lower_material, load_value, load_unit, temperature_value, temperature_unit,
                duration_value, duration_unit, operator, experiment_date, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                &id,
                &formulation_id,
                field_string(&payload, "testType")
                    .or_else(|| field_string(&payload, "test_type"))
                    .unwrap_or_default(),
                field_string(&payload, "testStandard")
                    .or_else(|| field_string(&payload, "test_standard"))
                    .unwrap_or_default(),
                field_string(&payload, "instrument").unwrap_or_default(),
                field_string(&payload, "upperMaterial")
                    .or_else(|| field_string(&payload, "upper_material"))
                    .unwrap_or_default(),
                field_string(&payload, "lowerMaterial")
                    .or_else(|| field_string(&payload, "lower_material"))
                    .unwrap_or_default(),
                field_f64(&payload, "loadValue").or_else(|| field_f64(&payload, "load_value")),
                field_string(&payload, "loadUnit")
                    .or_else(|| field_string(&payload, "load_unit"))
                    .unwrap_or_else(|| "N".to_string()),
                field_f64(&payload, "temperatureValue")
                    .or_else(|| field_f64(&payload, "temperature_value")),
                field_string(&payload, "temperatureUnit")
                    .or_else(|| field_string(&payload, "temperature_unit"))
                    .unwrap_or_else(|| "C".to_string()),
                field_f64(&payload, "durationValue").or_else(|| field_f64(&payload, "duration_value")),
                field_string(&payload, "durationUnit")
                    .or_else(|| field_string(&payload, "duration_unit"))
                    .unwrap_or_else(|| "min".to_string()),
                field_string(&payload, "operator").unwrap_or_default(),
                field_string(&payload, "experimentDate")
                    .or_else(|| field_string(&payload, "experiment_date"))
                    .unwrap_or_else(|| now.chars().take(10).collect()),
                field_string(&payload, "notes").unwrap_or_default(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to create experiment: {err}"))?;
    get_experiment_by_id(&connection, &id)
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
pub fn create_performance_result(
    app: AppHandle,
    payload: Value,
) -> Result<PerformanceResultDto, String> {
    let experiment_id = field_string(&payload, "experimentId")
        .or_else(|| field_string(&payload, "experiment_id"))
        .ok_or_else(|| "Experiment is required for performance result records.".to_string())?;
    let id = field_string(&payload, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    let experiment_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM experiments WHERE id = ?1)",
            params![&experiment_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to validate performance result experiment: {err}"))?;
    if !experiment_exists {
        return Err(format!("Experiment does not exist: {experiment_id}"));
    }
    connection
        .execute(
            "INSERT INTO performance_results (
                id, experiment_id, average_friction_coefficient, stable_friction_coefficient,
                wear_scar_width_value, wear_scar_diameter_value, initial_oxidation_temperature_value,
                extreme_pressure_value, pb_value, pd_value, viscosity_40c, viscosity_100c,
                repeat_count, std_json, raw_result_json, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                &id,
                &experiment_id,
                field_f64(&payload, "averageFrictionCoefficient")
                    .or_else(|| field_f64(&payload, "average_friction_coefficient")),
                field_f64(&payload, "stableFrictionCoefficient")
                    .or_else(|| field_f64(&payload, "stable_friction_coefficient")),
                field_f64(&payload, "wearScarWidthValue")
                    .or_else(|| field_f64(&payload, "wear_scar_width_value")),
                field_f64(&payload, "wearScarDiameterValue")
                    .or_else(|| field_f64(&payload, "wear_scar_diameter_value")),
                field_f64(&payload, "initialOxidationTemperatureValue")
                    .or_else(|| field_f64(&payload, "initial_oxidation_temperature_value")),
                field_f64(&payload, "extremePressureValue")
                    .or_else(|| field_f64(&payload, "extreme_pressure_value")),
                field_f64(&payload, "pbValue").or_else(|| field_f64(&payload, "pb_value")),
                field_f64(&payload, "pdValue").or_else(|| field_f64(&payload, "pd_value")),
                field_f64(&payload, "viscosity40c").or_else(|| field_f64(&payload, "viscosity_40c")),
                field_f64(&payload, "viscosity100c").or_else(|| field_f64(&payload, "viscosity_100c")),
                field_i64(&payload, "repeatCount").or_else(|| field_i64(&payload, "repeat_count")),
                "{}",
                "{}",
                field_string(&payload, "notes").unwrap_or_default(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to create performance result: {err}"))?;
    get_performance_result_by_id(&connection, &id)
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

fn get_experiment_by_id(connection: &Connection, id: &str) -> Result<ExperimentDto, String> {
    connection
        .query_row(
            "SELECT e.id, e.formulation_id, COALESCE(f.name, ''), e.test_type, e.test_standard,
                    e.instrument, e.upper_material, e.lower_material, e.load_value, e.load_unit,
                    e.temperature_value, e.temperature_unit, e.duration_value, e.duration_unit,
                    e.operator, e.experiment_date, e.notes, e.created_at, e.updated_at
             FROM experiments e
             LEFT JOIN formulations f ON f.id = e.formulation_id
             WHERE e.id = ?1",
            params![id],
            |row| {
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
            },
        )
        .map_err(|err| format!("Failed to load experiment: {err}"))
}

fn get_performance_result_by_id(
    connection: &Connection,
    id: &str,
) -> Result<PerformanceResultDto, String> {
    connection
        .query_row(
            "SELECT id, experiment_id, average_friction_coefficient, stable_friction_coefficient,
                    wear_scar_width_value, wear_scar_diameter_value,
                    initial_oxidation_temperature_value, extreme_pressure_value, pb_value, pd_value,
                    viscosity_40c, viscosity_100c, repeat_count, std_json, raw_result_json,
                    notes, created_at, updated_at
             FROM performance_results
             WHERE id = ?1",
            params![id],
            |row| {
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
                    std_json: parse_json_text(
                        row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                    ),
                    raw_result_json: parse_json_text(
                        row.get::<_, Option<String>>(14)?.unwrap_or_default(),
                    ),
                    notes: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
                    created_at: row.get(16)?,
                    updated_at: row.get(17)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load performance result: {err}"))
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

fn field_i64(payload: &Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(|value| match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    })
}
