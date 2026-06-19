use crate::app_paths::default_database_path;
use crate::commands::ok;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationDto {
    pub id: String,
    pub name: String,
    pub base_oil: String,
    pub additive_count: i64,
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
pub fn create_formulation(payload: Value) -> Result<Value, String> {
    ok(
        "create_formulation",
        json!({ "id": Uuid::new_v4(), "payload": payload }),
    )
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
    let formulations = list_formulations(app, None)?;
    Ok(formulations.into_iter().find(|item| item.id == id))
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
