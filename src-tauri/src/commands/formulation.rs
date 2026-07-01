use crate::app_paths::default_database_path;
use crate::commands::ok;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationComponentDto {
    pub id: String,
    pub formulation_id: String,
    pub component_role: String,
    pub molecule_id: String,
    pub base_oil_id: String,
    pub additive_id: String,
    pub concentration_value: Option<f64>,
    pub concentration_unit: String,
    pub concentration_standard_value: Option<f64>,
    pub concentration_standard_unit: String,
    pub notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationDto {
    pub id: String,
    pub name: String,
    pub base_oil: String,
    pub additive_count: i64,
    pub components: Vec<FormulationComponentDto>,
    pub components_summary: String,
    pub preparation_method: String,
    pub preparation_temperature: Option<f64>,
    pub preparation_temperature_unit: String,
    pub preparation_time: Option<f64>,
    pub preparation_time_unit: String,
    pub stability_observation: String,
    pub experiment_count: i64,
    pub best_average_friction_coefficient: Option<f64>,
    pub best_wear_scar_diameter: Option<f64>,
    pub highest_oxidation_temperature: Option<f64>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_formulation(app: AppHandle, payload: Value) -> Result<FormulationDto, String> {
    let name = field_string(&payload, "name")
        .ok_or_else(|| "Formulation name is required.".to_string())?;
    let components = payload
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "At least one formulation component is required.".to_string())?;
    if !components
        .iter()
        .any(|component| field_string(component, "componentRole").as_deref() == Some("base_oil"))
    {
        return Err("A formulation requires one base oil component.".to_string());
    }

    let id = field_string(&payload, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let mut connection = open_connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start formulation create transaction: {err}"))?;
    transaction
        .execute(
            "INSERT INTO formulations (
                id, name, preparation_method, preparation_temperature, preparation_temperature_unit,
                preparation_time, preparation_time_unit, stability_observation, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                &id,
                &name,
                field_string(&payload, "preparationMethod")
                    .or_else(|| field_string(&payload, "preparation_method"))
                    .unwrap_or_default(),
                field_f64(&payload, "preparationTemperature")
                    .or_else(|| field_f64(&payload, "preparation_temperature")),
                field_string(&payload, "preparationTemperatureUnit")
                    .or_else(|| field_string(&payload, "preparation_temperature_unit"))
                    .unwrap_or_else(|| "C".to_string()),
                field_f64(&payload, "preparationTime")
                    .or_else(|| field_f64(&payload, "preparation_time")),
                field_string(&payload, "preparationTimeUnit")
                    .or_else(|| field_string(&payload, "preparation_time_unit"))
                    .unwrap_or_else(|| "min".to_string()),
                field_string(&payload, "stabilityObservation")
                    .or_else(|| field_string(&payload, "stability_observation"))
                    .unwrap_or_default(),
                field_string(&payload, "notes").unwrap_or_default(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to create formulation: {err}"))?;

    for component in components {
        let component_id =
            field_string(component, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
        let role = field_string(component, "componentRole")
            .or_else(|| field_string(component, "component_role"))
            .unwrap_or_else(|| "additive".to_string());
        transaction
            .execute(
                "INSERT INTO formulation_components (
                    id, formulation_id, component_role, molecule_id, base_oil_id, additive_id,
                    concentration_value, concentration_unit, concentration_standard_value,
                    concentration_standard_unit, notes
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    &component_id,
                    &id,
                    role,
                    field_string(component, "moleculeId")
                        .or_else(|| field_string(component, "molecule_id")),
                    field_string(component, "baseOilId")
                        .or_else(|| field_string(component, "base_oil_id")),
                    field_string(component, "additiveId")
                        .or_else(|| field_string(component, "additive_id")),
                    field_f64(component, "concentrationValue")
                        .or_else(|| field_f64(component, "concentration_value")),
                    field_string(component, "concentrationUnit")
                        .or_else(|| field_string(component, "concentration_unit"))
                        .unwrap_or_else(|| "wt%".to_string()),
                    field_f64(component, "concentrationStandardValue")
                        .or_else(|| field_f64(component, "concentration_standard_value")),
                    field_string(component, "concentrationStandardUnit")
                        .or_else(|| field_string(component, "concentration_standard_unit"))
                        .unwrap_or_default(),
                    field_string(component, "notes").unwrap_or_default()
                ],
            )
            .map_err(|err| format!("Failed to create formulation component: {err}"))?;
    }
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit formulation create transaction: {err}"))?;
    get_formulation_by_id(&connection, &id)
}

#[tauri::command]
pub fn list_formulations(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<FormulationDto>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, preparation_method, preparation_temperature,
                    preparation_temperature_unit, preparation_time, preparation_time_unit,
                    stability_observation, notes, created_at, updated_at
             FROM formulations
             ORDER BY datetime(created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare formulation list query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let (base_oil, additive_count, components_summary) =
                formulation_components_summary(&connection, &id)?;
            let components = formulation_components(&connection, &id)?;
            let (
                experiment_count,
                best_average_friction_coefficient,
                best_wear_scar_diameter,
                highest_oxidation_temperature,
            ) = formulation_performance_summary(&connection, &id)?;

            Ok(FormulationDto {
                id,
                name: row.get(1)?,
                base_oil,
                additive_count,
                components,
                components_summary,
                preparation_method: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                preparation_temperature: row.get(3)?,
                preparation_temperature_unit: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                preparation_time: row.get(5)?,
                preparation_time_unit: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                stability_observation: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                experiment_count,
                best_average_friction_coefficient,
                best_wear_scar_diameter,
                highest_oxidation_temperature,
                notes: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|err| format!("Failed to query formulations: {err}"))?;
    let mut formulations = Vec::new();
    for row in rows {
        formulations.push(row.map_err(|err| format!("Failed to read formulation row: {err}"))?);
    }
    Ok(formulations)
}

#[tauri::command]
pub fn get_formulation(app: AppHandle, id: String) -> Result<Option<FormulationDto>, String> {
    let connection = open_connection(&app)?;
    match get_formulation_by_id(&connection, &id) {
        Ok(item) => Ok(Some(item)),
        Err(message) if message.contains("Query returned no rows") => Ok(None),
        Err(message) => Err(message),
    }
}

#[tauri::command]
pub fn delete_formulation(app: AppHandle, id: String) -> Result<Value, String> {
    let mut connection = open_connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start formulation delete transaction: {err}"))?;
    transaction
        .execute(
            "DELETE FROM performance_results
             WHERE experiment_id IN (SELECT id FROM experiments WHERE formulation_id = ?1)",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete formulation performance results: {err}"))?;
    transaction
        .execute(
            "DELETE FROM experiments WHERE formulation_id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete formulation experiments: {err}"))?;
    transaction
        .execute(
            "DELETE FROM formulation_components WHERE formulation_id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete formulation components: {err}"))?;
    let deleted = transaction
        .execute("DELETE FROM formulations WHERE id = ?1", params![&id])
        .map_err(|err| format!("Failed to delete formulation: {err}"))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit formulation delete transaction: {err}"))?;
    Ok(json!({ "success": deleted > 0, "deleted": deleted > 0, "id": id }))
}

#[tauri::command]
pub fn add_formulation_component(payload: Value) -> Result<Value, String> {
    ok(
        "add_formulation_component",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
}

#[tauri::command]
pub fn update_formulation_component(id: String, payload: Value) -> Result<Value, String> {
    ok(
        "update_formulation_component",
        json!({ "id": id, "payload": payload }),
    )
}

#[tauri::command]
pub fn delete_formulation_component(id: String) -> Result<Value, String> {
    ok(
        "delete_formulation_component",
        json!({ "id": id, "deleted": false, "phase": "mvp_skeleton" }),
    )
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn get_formulation_by_id(connection: &Connection, id: &str) -> Result<FormulationDto, String> {
    connection
        .query_row(
            "SELECT id, name, preparation_method, preparation_temperature,
                    preparation_temperature_unit, preparation_time, preparation_time_unit,
                    stability_observation, notes, created_at, updated_at
             FROM formulations
             WHERE id = ?1",
            params![id],
            |row| {
                let id: String = row.get(0)?;
                let (base_oil, additive_count, components_summary) =
                    formulation_components_summary(connection, &id)?;
                let components = formulation_components(connection, &id)?;
                let (
                    experiment_count,
                    best_average_friction_coefficient,
                    best_wear_scar_diameter,
                    highest_oxidation_temperature,
                ) = formulation_performance_summary(connection, &id)?;
                Ok(FormulationDto {
                    id,
                    name: row.get(1)?,
                    base_oil,
                    additive_count,
                    components,
                    components_summary,
                    preparation_method: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    preparation_temperature: row.get(3)?,
                    preparation_temperature_unit: row
                        .get::<_, Option<String>>(4)?
                        .unwrap_or_default(),
                    preparation_time: row.get(5)?,
                    preparation_time_unit: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    stability_observation: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    experiment_count,
                    best_average_friction_coefficient,
                    best_wear_scar_diameter,
                    highest_oxidation_temperature,
                    notes: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load formulation: {err}"))
}

fn formulation_components(
    connection: &Connection,
    formulation_id: &str,
) -> rusqlite::Result<Vec<FormulationComponentDto>> {
    let mut statement = connection.prepare(
        "SELECT id, formulation_id, component_role, molecule_id, base_oil_id, additive_id,
                concentration_value, concentration_unit, concentration_standard_value,
                concentration_standard_unit, notes
         FROM formulation_components
         WHERE formulation_id = ?1
         ORDER BY id",
    )?;
    let rows = statement.query_map(params![formulation_id], |row| {
        Ok(FormulationComponentDto {
            id: row.get(0)?,
            formulation_id: row.get(1)?,
            component_role: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            molecule_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            base_oil_id: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            additive_id: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            concentration_value: row.get(6)?,
            concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            concentration_standard_value: row.get(8)?,
            concentration_standard_unit: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
            notes: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
        })
    })?;
    let mut components = Vec::new();
    for row in rows {
        components.push(row?);
    }
    Ok(components)
}

fn formulation_components_summary(
    connection: &Connection,
    formulation_id: &str,
) -> rusqlite::Result<(String, i64, String)> {
    let base_oil = connection
        .query_row(
            "SELECT COALESCE(bo.name, m.name, '')
             FROM formulation_components fc
             LEFT JOIN base_oils bo ON bo.id = fc.base_oil_id
             LEFT JOIN molecules m ON m.id = fc.molecule_id
             WHERE fc.formulation_id = ?1 AND fc.component_role = 'base_oil'
             ORDER BY fc.id
             LIMIT 1",
            params![formulation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();

    let additive_count = connection.query_row(
        "SELECT COUNT(*) FROM formulation_components
         WHERE formulation_id = ?1 AND component_role = 'additive'",
        params![formulation_id],
        |row| row.get(0),
    )?;

    let mut statement = connection.prepare(
        "SELECT COALESCE(bo.name, m.name, a.id, fc.component_role),
                fc.concentration_value,
                fc.concentration_unit
         FROM formulation_components fc
         LEFT JOIN base_oils bo ON bo.id = fc.base_oil_id
         LEFT JOIN additives a ON a.id = fc.additive_id
         LEFT JOIN molecules m ON m.id = COALESCE(fc.molecule_id, a.molecule_id)
         WHERE fc.formulation_id = ?1
         ORDER BY fc.id",
    )?;
    let rows = statement.query_map(params![formulation_id], |row| {
        let name = row.get::<_, Option<String>>(0)?.unwrap_or_default();
        let concentration = row.get::<_, Option<f64>>(1)?;
        let unit = row.get::<_, Option<String>>(2)?.unwrap_or_default();
        Ok(match concentration {
            Some(value) if !unit.is_empty() => format!("{name} {value} {unit}"),
            Some(value) => format!("{name} {value}"),
            None => name,
        })
    })?;
    let mut components = Vec::new();
    for row in rows {
        let component = row?;
        if !component.trim().is_empty() {
            components.push(component);
        }
    }

    Ok((base_oil, additive_count, components.join(" + ")))
}

fn formulation_performance_summary(
    connection: &Connection,
    formulation_id: &str,
) -> rusqlite::Result<(i64, Option<f64>, Option<f64>, Option<f64>)> {
    connection.query_row(
        "SELECT COUNT(DISTINCT e.id),
                MIN(pr.average_friction_coefficient),
                MIN(pr.wear_scar_diameter_value),
                MAX(pr.initial_oxidation_temperature_value)
         FROM experiments e
         LEFT JOIN performance_results pr ON pr.experiment_id = e.id
         WHERE e.formulation_id = ?1",
        params![formulation_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
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
