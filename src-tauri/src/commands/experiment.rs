use crate::app_paths::default_database_path;
use crate::commands::attachments;
use crate::commands::experiment_protocol::{save_parameters, TestParameters};
use crate::commands::pagination::{Page, PageRequest};
use crate::commands::patch;
use crate::commands::validation;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
    pub test_parameters: TestParameters,
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
    pub initial_decomposition_temperature_value: Option<f64>,
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

pub const EXPERIMENT_SELECT: &str =
    "SELECT e.id, e.formulation_id, COALESCE(f.name, ''), e.test_type,
            e.test_standard, e.instrument, e.upper_material, e.lower_material, e.load_value,
            e.load_unit, e.temperature_value, e.temperature_unit, e.duration_value, e.duration_unit,
            e.operator, e.experiment_date, e.notes, e.created_at, e.updated_at, e.test_parameters_json
     FROM experiments e
     LEFT JOIN formulations f ON f.id = e.formulation_id";

/// `created_at` alone ties for rows written in the same second, which would let a row appear on
/// two pages while another was never shown.
pub const EXPERIMENT_ORDER: &str =
    " ORDER BY datetime(e.created_at) DESC, e.created_at DESC, e.id DESC";

fn read_experiment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExperimentDto> {
    Ok(ExperimentDto {
        id: row.get(0)?,
        formulation_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        formulation_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        test_type: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        test_parameters: serde_json::from_str(
            &row.get::<_, Option<String>>(19)?
                .unwrap_or_else(|| "{}".into()),
        )
        .unwrap_or_default(),
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
}

#[tauri::command]
pub fn list_experiments(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<ExperimentDto>, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{EXPERIMENT_SELECT}{EXPERIMENT_ORDER}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare experiment list query: {err}"))?;
    let rows = statement
        .query_map([], read_experiment_row)
        .map_err(|err| format!("Failed to query experiments: {err}"))?;
    collect_rows(rows, "experiment")
}

/// One bounded page of experiments, searchable by the blend or the test type.
#[tauri::command]
pub fn list_experiments_page(
    app: AppHandle,
    request: Option<PageRequest>,
) -> Result<Page<ExperimentDto>, String> {
    let request = request.unwrap_or_default();
    let resolved = request.resolve();
    let connection = open_connection(&app)?;
    let pattern = request.like_pattern();

    let total: i64 = match &pattern {
        Some(value) => connection.query_row(
            "SELECT COUNT(*) FROM experiments e LEFT JOIN formulations f ON f.id = e.formulation_id
             WHERE COALESCE(f.name, '') LIKE ?1 ESCAPE '\\'
                OR COALESCE(e.test_type, '') LIKE ?1 ESCAPE '\\'",
            params![value],
            |row| row.get(0),
        ),
        None => connection.query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0)),
    }
    .map_err(|err| format!("Failed to count experiments: {err}"))?;

    let filter = match pattern {
        Some(_) => {
            " WHERE COALESCE(f.name, '') LIKE ?3 ESCAPE '\\'               OR COALESCE(e.test_type, '') LIKE ?3 ESCAPE '\\'"
        }
        None => "",
    };
    let sql = format!("{EXPERIMENT_SELECT}{filter}{EXPERIMENT_ORDER} LIMIT ?1 OFFSET ?2");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the experiment page query: {err}"))?;
    let rows = match &pattern {
        Some(value) => statement.query_map(
            params![resolved.limit, resolved.offset, value],
            read_experiment_row,
        ),
        None => statement.query_map(
            params![resolved.limit, resolved.offset],
            read_experiment_row,
        ),
    }
    .map_err(|err| format!("Failed to query the experiment page: {err}"))?;
    Ok(Page::new(
        collect_rows(rows, "experiment")?,
        total,
        resolved,
    ))
}

pub const PERFORMANCE_SELECT: &str = "SELECT id, experiment_id, average_friction_coefficient,
            stable_friction_coefficient, wear_scar_width_value, wear_scar_diameter_value,
            initial_oxidation_temperature_value, extreme_pressure_value, pb_value, pd_value,
            viscosity_40c, viscosity_100c, repeat_count, std_json, raw_result_json, notes,
            created_at, updated_at, initial_decomposition_temperature_value
     FROM performance_results";

pub const PERFORMANCE_ORDER: &str = " ORDER BY datetime(created_at) DESC, created_at DESC, id DESC";

fn read_performance_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PerformanceResultDto> {
    Ok(PerformanceResultDto {
        id: row.get(0)?,
        experiment_id: row.get(1)?,
        average_friction_coefficient: row.get(2)?,
        stable_friction_coefficient: row.get(3)?,
        wear_scar_width_value: row.get(4)?,
        wear_scar_diameter_value: row.get(5)?,
        initial_decomposition_temperature_value: row.get(18)?,
        initial_oxidation_temperature_value: row.get(6)?,
        extreme_pressure_value: row.get(7)?,
        pb_value: row.get(8)?,
        pd_value: row.get(9)?,
        viscosity_40c: row.get(10)?,
        viscosity_100c: row.get(11)?,
        repeat_count: row.get(12)?,
        std_json: parse_json_text(row.get::<_, Option<String>>(13)?.unwrap_or_default()),
        raw_result_json: parse_json_text(row.get::<_, Option<String>>(14)?.unwrap_or_default()),
        notes: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

#[tauri::command]
pub fn list_performance_results(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<PerformanceResultDto>, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{PERFORMANCE_SELECT}{PERFORMANCE_ORDER}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare performance result list query: {err}"))?;
    let rows = statement
        .query_map([], read_performance_row)
        .map_err(|err| format!("Failed to query performance results: {err}"))?;
    collect_rows(rows, "performance result")
}

/// One bounded page of performance results.
#[tauri::command]
pub fn list_performance_results_page(
    app: AppHandle,
    request: Option<PageRequest>,
) -> Result<Page<PerformanceResultDto>, String> {
    let request = request.unwrap_or_default();
    let resolved = request.resolve();
    let connection = open_connection(&app)?;

    let total: i64 = connection
        .query_row("SELECT COUNT(*) FROM performance_results", [], |row| {
            row.get(0)
        })
        .map_err(|err| format!("Failed to count performance results: {err}"))?;
    let sql = format!("{PERFORMANCE_SELECT}{PERFORMANCE_ORDER} LIMIT ?1 OFFSET ?2");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the performance result page query: {err}"))?;
    let rows = statement
        .query_map(
            params![resolved.limit, resolved.offset],
            read_performance_row,
        )
        .map_err(|err| format!("Failed to query the performance result page: {err}"))?;
    Ok(Page::new(
        collect_rows(rows, "performance result")?,
        total,
        resolved,
    ))
}

/// One experiment and the results measured for it.
///
/// This used to load *every* experiment and *every* performance result in the workspace and then
/// filter both lists in Rust to find one experiment. On a workspace with real history that is two
/// full table scans and two full serializations to answer a question about a single row.
#[tauri::command]
pub fn get_experiment_with_results(
    app: AppHandle,
    id: String,
) -> Result<ExperimentWithResultsDto, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{EXPERIMENT_SELECT} WHERE e.id = ?1");
    let experiment = connection
        .query_row(&sql, params![&id], read_experiment_row)
        .optional()
        .map_err(|err| format!("Failed to load experiment {id}: {err}"))?;

    let results_sql = format!("{PERFORMANCE_SELECT} WHERE experiment_id = ?1{PERFORMANCE_ORDER}");
    let mut statement = connection
        .prepare(&results_sql)
        .map_err(|err| format!("Failed to prepare the result query: {err}"))?;
    let rows = statement
        .query_map(params![&id], read_performance_row)
        .map_err(|err| format!("Failed to query results for {id}: {err}"))?;

    Ok(ExperimentWithResultsDto {
        experiment,
        experiments: Vec::new(),
        results: collect_rows(rows, "performance result")?,
    })
}

/// Every experiment recorded against one formulation, with the results measured for them.
///
/// The formulation screen used to read *every* experiment and *every* performance result in the
/// workspace and filter both lists in the browser to find the handful attached to one blend.
#[tauri::command]
pub fn list_formulation_experiments(
    app: AppHandle,
    formulation_id: String,
) -> Result<ExperimentWithResultsDto, String> {
    let connection = open_connection(&app)?;

    let sql = format!("{EXPERIMENT_SELECT} WHERE e.formulation_id = ?1{EXPERIMENT_ORDER}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the formulation experiment query: {err}"))?;
    let experiments = collect_rows(
        statement
            .query_map(params![&formulation_id], read_experiment_row)
            .map_err(|err| format!("Failed to query experiments for {formulation_id}: {err}"))?,
        "experiment",
    )?;
    drop(statement);

    // One query for the results too, joined on the formulation rather than fetched per experiment.
    let results_sql = format!(
        "{PERFORMANCE_SELECT}
         WHERE experiment_id IN (SELECT id FROM experiments WHERE formulation_id = ?1)
         {PERFORMANCE_ORDER}"
    );
    let mut statement = connection
        .prepare(&results_sql)
        .map_err(|err| format!("Failed to prepare the formulation result query: {err}"))?;
    let results = collect_rows(
        statement
            .query_map(params![&formulation_id], read_performance_row)
            .map_err(|err| format!("Failed to query results for {formulation_id}: {err}"))?,
        "performance result",
    )?;

    Ok(ExperimentWithResultsDto {
        experiment: None,
        experiments,
        results,
    })
}

/// What `get_experiment_with_results` returns: typed, rather than a loose JSON envelope the
/// frontend had to unwrap with `data ?? value`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentWithResultsDto {
    /// The single experiment a caller asked for by id; `None` when it asked by formulation.
    pub experiment: Option<ExperimentDto>,
    /// Every experiment, when the caller asked by formulation. Empty for a single-id lookup.
    pub experiments: Vec<ExperimentDto>,
    pub results: Vec<PerformanceResultDto>,
}

#[tauri::command]
pub fn update_experiment(
    app: AppHandle,
    id: String,
    payload: Value,
) -> Result<ExperimentDto, String> {
    let mut connection = open_connection(&app)?;
    update_experiment_in_connection(&mut connection, id, payload)
}

pub fn update_experiment_in_connection(
    connection: &mut Connection,
    id: String,
    payload: Value,
) -> Result<ExperimentDto, String> {
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let connection = &transaction;

    if !experiment_exists(connection, &id)? {
        return Err(format!("Experiment not found: {id}"));
    }
    if let Some(formulation_id) =
        field_string(&payload, "formulationId").or_else(|| field_string(&payload, "formulation_id"))
    {
        let formulation_exists: i64 = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM formulations WHERE id = ?1)",
                params![&formulation_id],
                |row| row.get(0),
            )
            .map_err(|err| format!("Failed to look up formulation {formulation_id}: {err}"))?;
        if formulation_exists != 1 {
            return Err(format!("Formulation not found: {formulation_id}"));
        }
    }
    let now = Utc::now().to_rfc3339();
    // Every optional field can be cleared; only the formulation link is protected.
    // The formulation link is required by the schema: it can change, not be cleared.
    let formulation_id = match patch::text(&payload, "formulationId", "formulation_id")? {
        patch::FieldPatch::Clear => {
            return Err("An experiment must stay linked to a formulation.".to_string())
        }
        other => other,
    };
    let test_type = patch::text(&payload, "testType", "test_type")?;
    let test_standard = patch::text(&payload, "testStandard", "test_standard")?;
    let instrument = patch::text(&payload, "instrument", "instrument")?;
    let upper_material = patch::text(&payload, "upperMaterial", "upper_material")?;
    let lower_material = patch::text(&payload, "lowerMaterial", "lower_material")?;
    let load_value = patch::number(&payload, "loadValue", "load_value")?;
    let load_unit = patch::text(&payload, "loadUnit", "load_unit")?;
    let temperature_value = patch::number(&payload, "temperatureValue", "temperature_value")?;
    let temperature_unit = patch::text(&payload, "temperatureUnit", "temperature_unit")?;
    let duration_value = patch::number(&payload, "durationValue", "duration_value")?;
    let duration_unit = patch::text(&payload, "durationUnit", "duration_unit")?;
    let operator = patch::text(&payload, "operator", "operator")?;
    let experiment_date = patch::text(&payload, "experimentDate", "experiment_date")?;
    let notes = patch::text(&payload, "notes", "notes")?;
    connection
        .execute(
            "UPDATE experiments SET
                formulation_id = CASE WHEN ?2 THEN formulation_id ELSE ?3 END,
                test_type = CASE WHEN ?4 THEN test_type ELSE ?5 END,
                test_standard = CASE WHEN ?6 THEN test_standard ELSE ?7 END,
                instrument = CASE WHEN ?8 THEN instrument ELSE ?9 END,
                upper_material = CASE WHEN ?10 THEN upper_material ELSE ?11 END,
                lower_material = CASE WHEN ?12 THEN lower_material ELSE ?13 END,
                load_value = CASE WHEN ?14 THEN load_value ELSE ?15 END,
                load_unit = CASE WHEN ?16 THEN load_unit ELSE ?17 END,
                temperature_value = CASE WHEN ?18 THEN temperature_value ELSE ?19 END,
                temperature_unit = CASE WHEN ?20 THEN temperature_unit ELSE ?21 END,
                duration_value = CASE WHEN ?22 THEN duration_value ELSE ?23 END,
                duration_unit = CASE WHEN ?24 THEN duration_unit ELSE ?25 END,
                operator = CASE WHEN ?26 THEN operator ELSE ?27 END,
                experiment_date = CASE WHEN ?28 THEN experiment_date ELSE ?29 END,
                notes = CASE WHEN ?30 THEN notes ELSE ?31 END,
                updated_at = ?32
             WHERE id = ?1",
            params![
                &id,
                formulation_id.is_unchanged(),
                patch::Patched(formulation_id),
                test_type.is_unchanged(),
                patch::Patched(test_type),
                test_standard.is_unchanged(),
                patch::Patched(test_standard),
                instrument.is_unchanged(),
                patch::Patched(instrument),
                upper_material.is_unchanged(),
                patch::Patched(upper_material),
                lower_material.is_unchanged(),
                patch::Patched(lower_material),
                load_value.is_unchanged(),
                patch::Patched(load_value),
                load_unit.is_unchanged(),
                patch::Patched(load_unit),
                temperature_value.is_unchanged(),
                patch::Patched(temperature_value),
                temperature_unit.is_unchanged(),
                patch::Patched(temperature_unit),
                duration_value.is_unchanged(),
                patch::Patched(duration_value),
                duration_unit.is_unchanged(),
                patch::Patched(duration_unit),
                operator.is_unchanged(),
                patch::Patched(operator),
                experiment_date.is_unchanged(),
                patch::Patched(experiment_date),
                notes.is_unchanged(),
                patch::Patched(notes),
                &now
            ],
        )
        .map_err(|err| format!("Failed to update experiment: {err}"))?;
    let current = get_experiment_by_id(connection, &id)?;
    if current.test_type == "kinematic-viscosity"
        && !matches!(current.temperature_value, Some(40.0 | 100.0))
    {
        return Err("Kinematic viscosity requires a test temperature of 40 or 100 C.".into());
    }
    if let Some(value) = payload.get("testParameters") {
        let mut parameters: TestParameters =
            serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        parameters = parameters.validate(&current.test_type)?;
        parameters.resolve_environment(connection, &current.test_type, &id, &now)?;
        save_parameters(connection, &id, &parameters)?;
    } else if payload.get("testType").is_some() || payload.get("test_type").is_some() {
        let mut parameters = current.test_parameters.validate(&current.test_type)?;
        for (key, slot) in [
            ("ambientTemperatureC", &mut parameters.ambient_temperature_c),
            ("humidityPercent", &mut parameters.humidity_percent),
        ] {
            if parameters.environment_provenance[key]["source"] == "mean" {
                *slot = None;
            }
        }
        parameters.resolve_environment(connection, &current.test_type, &id, &now)?;
        save_parameters(connection, &id, &parameters)?;
    }
    if let Some(result_id) = payload.get("performanceResultId").and_then(Value::as_str) {
        let owner: String = connection
            .query_row(
                "SELECT experiment_id FROM performance_results WHERE id=?1",
                params![result_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if owner != id {
            return Err("The performance result belongs to a different experiment.".into());
        }
        update_performance_in_connection(connection, result_id, &payload)?;
    }
    let updated = get_experiment_by_id(connection, &id)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_experiment(app: AppHandle, id: String) -> Result<Value, String> {
    let workspace = attachments::workspace_dir(&app)?;
    let mut connection = open_connection(&app)?;

    let paths = attachments::attachment_paths(&connection, attachments::ENTITY_EXPERIMENT, &id)?;
    // Results and attachments hang off the experiment, so the whole removal is one transaction,
    // wrapped by the quarantine so a file that cannot be moved aside stops the delete outright.
    let ((deleted, deleted_results, deleted_attachments), removed_files, cleanup_failures) =
        attachments::delete_with_files(&workspace, &paths, || {
            let transaction = connection
                .transaction()
                .map_err(|err| format!("Failed to start experiment delete transaction: {err}"))?;
            let deleted_results = transaction
                .execute(
                    "DELETE FROM performance_results WHERE experiment_id = ?1",
                    params![&id],
                )
                .map_err(|err| format!("Failed to delete performance results: {err}"))?;
            let deleted_attachments = attachments::delete_attachment_rows(
                &transaction,
                attachments::ENTITY_EXPERIMENT,
                &id,
            )?;
            let deleted = transaction
                .execute("DELETE FROM experiments WHERE id = ?1", params![&id])
                .map_err(|err| format!("Failed to delete experiment: {err}"))?;
            if deleted == 0 {
                // Rolling back here restores the quarantined files as well, because the caller
                // treats a failed commit as "nothing happened".
                return Err(format!("Experiment not found: {id}"));
            }
            transaction
                .commit()
                .map_err(|err| format!("Failed to commit experiment delete transaction: {err}"))?;
            Ok((deleted, deleted_results, deleted_attachments))
        })?;

    Ok(json!({
        "success": deleted > 0,
        "deleted": deleted > 0,
        "id": id,
        "deletedPerformanceResults": deleted_results,
        "deletedAttachments": deleted_attachments,
        "removedFiles": removed_files,
        "cleanupFailures": cleanup_failures
    }))
}

#[tauri::command]
pub fn update_performance_result(
    app: AppHandle,
    id: String,
    payload: Value,
) -> Result<PerformanceResultDto, String> {
    let connection = open_connection(&app)?;
    update_performance_in_connection(&connection, &id, &payload)
}

fn update_performance_in_connection(
    connection: &Connection,
    id: &str,
    payload: &Value,
) -> Result<PerformanceResultDto, String> {
    let experiment_id: String = connection
        .query_row(
            "SELECT experiment_id FROM performance_results WHERE id = ?1",
            params![&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to look up performance result {id}: {err}"))?
        .ok_or_else(|| format!("Performance result not found: {id}"))?;
    let now = Utc::now().to_rfc3339();
    // A measurement that turns out to be wrong must be removable, so every value can be cleared
    // and a genuine zero is stored as zero.
    let average_friction_coefficient = patch::number(
        payload,
        "averageFrictionCoefficient",
        "average_friction_coefficient",
    )?;
    let stable_friction_coefficient = patch::number(
        payload,
        "stableFrictionCoefficient",
        "stable_friction_coefficient",
    )?;
    let wear_scar_width_value =
        patch::number(payload, "wearScarWidthValue", "wear_scar_width_value")?;
    let wear_scar_diameter_value =
        patch::number(payload, "wearScarDiameterValue", "wear_scar_diameter_value")?;
    let initial_oxidation_temperature_value = patch::number(
        payload,
        "initialOxidationTemperatureValue",
        "initial_oxidation_temperature_value",
    )?;
    let extreme_pressure_value =
        patch::number(payload, "extremePressureValue", "extreme_pressure_value")?;
    let pb_value = patch::number(payload, "pbValue", "pb_value")?;
    let pd_value = patch::number(payload, "pdValue", "pd_value")?;
    let viscosity_40c = patch::number(payload, "viscosity40c", "viscosity_40c")?;
    let viscosity_100c = patch::number(payload, "viscosity100c", "viscosity_100c")?;
    let decomposition = patch::number(
        payload,
        "initialDecompositionTemperatureValue",
        "initial_decomposition_temperature_value",
    )?;
    let repeat_count = patch::integer(payload, "repeatCount", "repeat_count")?;
    let notes = patch::text(payload, "notes", "notes")?;
    connection
        .execute(
            "UPDATE performance_results SET
                average_friction_coefficient = CASE WHEN ?2 THEN average_friction_coefficient ELSE ?3 END,
                stable_friction_coefficient = CASE WHEN ?4 THEN stable_friction_coefficient ELSE ?5 END,
                wear_scar_width_value = CASE WHEN ?6 THEN wear_scar_width_value ELSE ?7 END,
                wear_scar_diameter_value = CASE WHEN ?8 THEN wear_scar_diameter_value ELSE ?9 END,
                initial_oxidation_temperature_value = CASE WHEN ?10 THEN initial_oxidation_temperature_value ELSE ?11 END,
                extreme_pressure_value = CASE WHEN ?12 THEN extreme_pressure_value ELSE ?13 END,
                pb_value = CASE WHEN ?14 THEN pb_value ELSE ?15 END,
                pd_value = CASE WHEN ?16 THEN pd_value ELSE ?17 END,
                viscosity_40c = CASE WHEN ?18 THEN viscosity_40c ELSE ?19 END,
                viscosity_100c = CASE WHEN ?20 THEN viscosity_100c ELSE ?21 END,
                repeat_count = CASE WHEN ?22 THEN repeat_count ELSE ?23 END,
                notes = CASE WHEN ?24 THEN notes ELSE ?25 END,
                initial_decomposition_temperature_value = CASE WHEN ?27 THEN initial_decomposition_temperature_value ELSE ?28 END,
                updated_at = ?26
             WHERE id = ?1",
            params![
                &id,
                average_friction_coefficient.is_unchanged(),
                patch::Patched(average_friction_coefficient),
                stable_friction_coefficient.is_unchanged(),
                patch::Patched(stable_friction_coefficient),
                wear_scar_width_value.is_unchanged(),
                patch::Patched(wear_scar_width_value),
                wear_scar_diameter_value.is_unchanged(),
                patch::Patched(wear_scar_diameter_value),
                initial_oxidation_temperature_value.is_unchanged(),
                patch::Patched(initial_oxidation_temperature_value),
                extreme_pressure_value.is_unchanged(),
                patch::Patched(extreme_pressure_value),
                pb_value.is_unchanged(),
                patch::Patched(pb_value),
                pd_value.is_unchanged(),
                patch::Patched(pd_value),
                viscosity_40c.is_unchanged(),
                patch::Patched(viscosity_40c),
                viscosity_100c.is_unchanged(),
                patch::Patched(viscosity_100c),
                repeat_count.is_unchanged(),
                patch::Patched(repeat_count),
                notes.is_unchanged(),
                patch::Patched(notes),
                &now, decomposition.is_unchanged(), patch::Patched(decomposition)
            ],
        )
        .map_err(|err| format!("Failed to update performance result: {err}"))?;
    let _ = experiment_id;
    get_performance_result_by_id(connection, id)
}

#[tauri::command]
pub fn delete_performance_result(app: AppHandle, id: String) -> Result<Value, String> {
    let connection = open_connection(&app)?;
    let deleted = connection
        .execute(
            "DELETE FROM performance_results WHERE id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete performance result: {err}"))?;
    if deleted == 0 {
        return Err(format!("Performance result not found: {id}"));
    }
    Ok(json!({ "success": true, "deleted": true, "id": id }))
}

#[tauri::command]
pub fn list_attachments(
    app: AppHandle,
    linked_entity_type: String,
    linked_entity_id: String,
) -> Result<Vec<Value>, String> {
    let connection = open_connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, linked_entity_type, linked_entity_id, file_name, file_type,
                    relative_path, description, uploaded_at
             FROM attachments
             WHERE linked_entity_type = ?1 AND linked_entity_id = ?2
             ORDER BY uploaded_at DESC, id DESC",
        )
        .map_err(|err| format!("Failed to prepare attachment query: {err}"))?;
    let rows = statement
        .query_map(params![linked_entity_type, linked_entity_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "linkedEntityType": row.get::<_, String>(1)?,
                "linkedEntityId": row.get::<_, String>(2)?,
                "fileName": row.get::<_, String>(3)?,
                "fileType": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "relativePath": row.get::<_, String>(5)?,
                "description": row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                "uploadedAt": row.get::<_, String>(7)?
            }))
        })
        .map_err(|err| format!("Failed to query attachments: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read an attachment row: {err}"))
}

fn experiment_exists(connection: &Connection, id: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM experiments WHERE id = ?1)",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|found| found == 1)
        .map_err(|err| format!("Failed to look up experiment {id}: {err}"))
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn get_experiment_by_id(connection: &Connection, id: &str) -> Result<ExperimentDto, String> {
    connection
        .query_row(
            &format!("{EXPERIMENT_SELECT} WHERE e.id = ?1"),
            params![id],
            read_experiment_row,
        )
        .map_err(|err| format!("Failed to load experiment: {err}"))
}

fn get_performance_result_by_id(
    connection: &Connection,
    id: &str,
) -> Result<PerformanceResultDto, String> {
    connection
        .query_row(
            &format!("{PERFORMANCE_SELECT} WHERE id = ?1"),
            params![id],
            read_performance_row,
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

// =================================================================================================
// Atomic experiment + performance-result write
// =================================================================================================

/// One test run and the numbers it produced, as the entry screen collects them.
///
/// The screen has always collected these together — one form, one button — but the frontend used
/// to send them as two commands. When the second one failed the first had already committed, and
/// the workspace kept an experiment with no result: a test that appears to have been run and
/// measured nothing. Nothing in the interface distinguished that from a test whose measurements
/// were genuinely still pending.
///
/// This is a typed request rather than a `serde_json::Value` so the shape is checked once, at the
/// boundary, instead of field by field at each `params!` site.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentWithPerformanceRequest {
    #[serde(default)]
    pub test_parameters: TestParameters,
    #[serde(default, deserialize_with = "validation::optional_number")]
    pub initial_decomposition_temperature_value: Option<f64>,
    #[serde(
        default,
        alias = "formulation_id",
        deserialize_with = "validation::optional_text"
    )]
    pub formulation_id: Option<String>,
    #[serde(
        default,
        alias = "test_type",
        deserialize_with = "validation::optional_text"
    )]
    pub test_type: Option<String>,
    #[serde(
        default,
        alias = "test_standard",
        deserialize_with = "validation::optional_text"
    )]
    pub test_standard: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub instrument: Option<String>,
    #[serde(
        default,
        alias = "upper_material",
        deserialize_with = "validation::optional_text"
    )]
    pub upper_material: Option<String>,
    #[serde(
        default,
        alias = "lower_material",
        deserialize_with = "validation::optional_text"
    )]
    pub lower_material: Option<String>,
    #[serde(
        default,
        alias = "load_value",
        deserialize_with = "validation::optional_number"
    )]
    pub load_value: Option<f64>,
    #[serde(
        default,
        alias = "load_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub load_unit: Option<String>,
    #[serde(
        default,
        alias = "temperature_value",
        deserialize_with = "validation::optional_number"
    )]
    pub temperature_value: Option<f64>,
    #[serde(
        default,
        alias = "temperature_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub temperature_unit: Option<String>,
    #[serde(
        default,
        alias = "duration_value",
        deserialize_with = "validation::optional_number"
    )]
    pub duration_value: Option<f64>,
    #[serde(
        default,
        alias = "duration_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub duration_unit: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub operator: Option<String>,
    #[serde(
        default,
        alias = "experiment_date",
        deserialize_with = "validation::optional_text"
    )]
    pub experiment_date: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub notes: Option<String>,

    // --- The measured half. ---
    #[serde(
        default,
        alias = "average_friction_coefficient",
        deserialize_with = "validation::optional_number"
    )]
    pub average_friction_coefficient: Option<f64>,
    #[serde(
        default,
        alias = "stable_friction_coefficient",
        deserialize_with = "validation::optional_number"
    )]
    pub stable_friction_coefficient: Option<f64>,
    #[serde(
        default,
        alias = "wear_scar_width_value",
        deserialize_with = "validation::optional_number"
    )]
    pub wear_scar_width_value: Option<f64>,
    #[serde(
        default,
        alias = "wear_scar_diameter_value",
        deserialize_with = "validation::optional_number"
    )]
    pub wear_scar_diameter_value: Option<f64>,
    #[serde(
        default,
        alias = "initial_oxidation_temperature_value",
        deserialize_with = "validation::optional_number"
    )]
    pub initial_oxidation_temperature_value: Option<f64>,
    #[serde(
        default,
        alias = "extreme_pressure_value",
        deserialize_with = "validation::optional_number"
    )]
    pub extreme_pressure_value: Option<f64>,
    #[serde(
        default,
        alias = "pb_value",
        deserialize_with = "validation::optional_number"
    )]
    pub pb_value: Option<f64>,
    #[serde(
        default,
        alias = "pd_value",
        deserialize_with = "validation::optional_number"
    )]
    pub pd_value: Option<f64>,
    #[serde(
        default,
        alias = "viscosity_40c",
        deserialize_with = "validation::optional_number"
    )]
    pub viscosity_40c: Option<f64>,
    #[serde(
        default,
        alias = "viscosity_100c",
        deserialize_with = "validation::optional_number"
    )]
    pub viscosity_100c: Option<f64>,
    #[serde(
        default,
        alias = "repeat_count",
        deserialize_with = "validation::optional_integer"
    )]
    pub repeat_count: Option<f64>,
    #[serde(
        default,
        alias = "result_notes",
        deserialize_with = "validation::optional_text"
    )]
    pub result_notes: Option<String>,
}

/// A request that has passed every rule. Nothing here needs re-checking at the `params!` site.
#[derive(Debug)]
pub struct ValidatedExperimentWrite {
    pub test_parameters: TestParameters,
    pub initial_decomposition_temperature_value: Option<f64>,
    pub formulation_id: String,
    pub test_type: String,
    pub test_standard: String,
    pub instrument: String,
    pub upper_material: String,
    pub lower_material: String,
    pub load_value: Option<f64>,
    pub load_unit: Option<String>,
    pub temperature_value: Option<f64>,
    pub temperature_unit: Option<String>,
    pub duration_value: Option<f64>,
    pub duration_unit: Option<String>,
    pub operator: String,
    pub experiment_date: Option<String>,
    pub notes: String,
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
    pub result_notes: String,
}

impl ExperimentWithPerformanceRequest {
    /// Checks every rule before a statement is prepared.
    ///
    /// The formulation link and the test type are required because an experiment without them
    /// cannot be interpreted later: nobody can say what was tested, or how. Every other field is
    /// optional, and every supplied number has to be finite — a NaN friction coefficient would
    /// otherwise be averaged into every summary the workspace produces.
    pub fn validate(mut self) -> Result<ValidatedExperimentWrite, String> {
        let formulation_id = validation::require_name(
            self.formulation_id.as_deref(),
            "A formulation for the experiment",
        )?;
        let test_type = validation::require_name(self.test_type.as_deref(), "The test type")?;

        if test_type == "kinematic-viscosity"
            && !matches!(self.temperature_value, Some(40.0 | 100.0))
        {
            return Err("Kinematic viscosity requires a test temperature of 40 or 100 C.".into());
        }
        if matches!(
            test_type.as_str(),
            "UMT" | "TE77" | "four-ball" | "PDSC" | "TGA" | "kinematic-viscosity"
        ) {
            if !matches!(test_type.as_str(), "UMT" | "TE77" | "four-ball") {
                self.average_friction_coefficient = None;
                self.stable_friction_coefficient = None;
                self.wear_scar_width_value = None;
                self.wear_scar_diameter_value = None;
                self.load_value = None;
                self.upper_material = None;
                self.lower_material = None;
            }
            if test_type != "four-ball" {
                self.extreme_pressure_value = None;
                self.pb_value = None;
                self.pd_value = None;
            }
            if test_type != "PDSC" {
                self.initial_oxidation_temperature_value = None;
            }
            if test_type != "TGA" {
                self.initial_decomposition_temperature_value = None;
            }
            if test_type != "kinematic-viscosity" || self.temperature_value != Some(40.0) {
                self.viscosity_40c = None;
            }
            if test_type != "kinematic-viscosity" || self.temperature_value != Some(100.0) {
                self.viscosity_100c = None;
            }
        }
        Ok(ValidatedExperimentWrite {
            test_parameters: self.test_parameters.validate(&test_type)?,
            initial_decomposition_temperature_value: validation::require_finite(
                self.initial_decomposition_temperature_value,
                "Initial decomposition temperature",
            )?,
            formulation_id,
            test_type,
            test_standard: self.test_standard.unwrap_or_default(),
            instrument: self.instrument.unwrap_or_default(),
            upper_material: self.upper_material.unwrap_or_default(),
            lower_material: self.lower_material.unwrap_or_default(),
            load_value: validation::require_finite(self.load_value, "Load")?,
            load_unit: self.load_unit,
            temperature_value: validation::require_finite(self.temperature_value, "Temperature")?,
            temperature_unit: self.temperature_unit,
            // A test that ran for a negative number of minutes did not happen.
            duration_value: validation::require_non_negative(self.duration_value, "Duration")?,
            duration_unit: self.duration_unit,
            operator: self.operator.unwrap_or_default(),
            experiment_date: self.experiment_date,
            notes: self.notes.unwrap_or_default(),
            average_friction_coefficient: validation::require_finite(
                self.average_friction_coefficient,
                "Average friction coefficient",
            )?,
            stable_friction_coefficient: validation::require_finite(
                self.stable_friction_coefficient,
                "Stable friction coefficient",
            )?,
            wear_scar_width_value: validation::require_finite(
                self.wear_scar_width_value,
                "Wear scar width",
            )?,
            wear_scar_diameter_value: validation::require_finite(
                self.wear_scar_diameter_value,
                "Wear scar diameter",
            )?,
            initial_oxidation_temperature_value: validation::require_finite(
                self.initial_oxidation_temperature_value,
                "Initial oxidation temperature",
            )?,
            extreme_pressure_value: validation::require_finite(
                self.extreme_pressure_value,
                "Extreme pressure value",
            )?,
            pb_value: validation::require_finite(self.pb_value, "PB value")?,
            pd_value: validation::require_finite(self.pd_value, "PD value")?,
            viscosity_40c: validation::require_finite(self.viscosity_40c, "Viscosity at 40 C")?,
            viscosity_100c: validation::require_finite(self.viscosity_100c, "Viscosity at 100 C")?,
            repeat_count: validation::require_repeat_count(self.repeat_count)?,
            result_notes: self.result_notes.unwrap_or_default(),
        })
    }
}

/// Writes both rows inside one transaction, or neither.
///
/// Separated from the Tauri command so an integration test can force the second insert to fail —
/// which is the only way to prove the rollback actually happens rather than merely being written
/// down. Takes `&mut Connection` because a transaction borrows it exclusively.
pub fn write_experiment_with_performance(
    connection: &mut Connection,
    request: &ValidatedExperimentWrite,
    now: &str,
) -> Result<(String, String), String> {
    let experiment_id = Uuid::new_v4().to_string();
    let result_id = Uuid::new_v4().to_string();

    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start the experiment save transaction: {err}"))?;

    // The formulation is checked inside the transaction: checking it outside would leave a window
    // in which it could be deleted between the check and the insert.
    let formulation_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM formulations WHERE id = ?1)",
            params![&request.formulation_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to validate experiment formulation: {err}"))?;
    if !formulation_exists {
        return Err(crate::commands::errors::coded(
            crate::commands::errors::RECORD_NOT_FOUND,
            format!("Formulation does not exist: {}", request.formulation_id),
        ));
    }

    transaction
        .execute(
            "INSERT INTO experiments (
                id, formulation_id, test_type, test_standard, instrument, upper_material,
                lower_material, load_value, load_unit, temperature_value, temperature_unit,
                duration_value, duration_unit, operator, experiment_date, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                &experiment_id,
                &request.formulation_id,
                &request.test_type,
                &request.test_standard,
                &request.instrument,
                &request.upper_material,
                &request.lower_material,
                request.load_value,
                request.load_unit.as_deref(),
                request.temperature_value,
                request.temperature_unit.as_deref(),
                request.duration_value,
                request.duration_unit.as_deref(),
                &request.operator,
                request.experiment_date.as_deref(),
                &request.notes,
                now
            ],
        )
        .map_err(|err| format!("Failed to create experiment: {err}"))?;

    transaction
        .execute(
            "INSERT INTO performance_results (
                id, experiment_id, average_friction_coefficient, stable_friction_coefficient,
                wear_scar_width_value, wear_scar_diameter_value, initial_oxidation_temperature_value,
                extreme_pressure_value, pb_value, pd_value, viscosity_40c, viscosity_100c,
                repeat_count, std_json, raw_result_json, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                &result_id,
                &experiment_id,
                request.average_friction_coefficient,
                request.stable_friction_coefficient,
                request.wear_scar_width_value,
                request.wear_scar_diameter_value,
                request.initial_oxidation_temperature_value,
                request.extreme_pressure_value,
                request.pb_value,
                request.pd_value,
                request.viscosity_40c,
                request.viscosity_100c,
                request.repeat_count,
                "{}",
                "{}",
                &request.result_notes,
                now
            ],
        )
        .map_err(|err| format!("Failed to create performance result: {err}"))?;

    let mut parameters = request.test_parameters.clone();
    parameters.resolve_environment(&transaction, &request.test_type, &experiment_id, now)?;
    save_parameters(&transaction, &experiment_id, &parameters)?;
    transaction
        .execute(
            "UPDATE performance_results SET initial_decomposition_temperature_value=?2 WHERE id=?1",
            params![&result_id, request.initial_decomposition_temperature_value],
        )
        .map_err(|e| format!("Failed to store thermal decomposition result: {e}"))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit the experiment save transaction: {err}"))?;

    Ok((experiment_id, result_id))
}

/// Both records this command wrote, typed rather than assembled as loose JSON.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentWithPerformanceDto {
    pub experiment: ExperimentDto,
    pub result: PerformanceResultDto,
}

/// Saves a test run and its measurements as one indivisible record.
#[tauri::command]
pub fn save_experiment_with_performance(
    app: AppHandle,
    payload: Value,
) -> Result<ExperimentWithPerformanceDto, String> {
    let request: ExperimentWithPerformanceRequest =
        serde_json::from_value(payload).map_err(|err| {
            crate::commands::errors::coded(
                crate::commands::errors::VALIDATION_PAYLOAD_EMPTY,
                format!("The experiment payload could not be read: {err}"),
            )
        })?;
    let validated = request.validate()?;
    let now = Utc::now().to_rfc3339();
    let mut connection = open_connection(&app)?;
    let (experiment_id, result_id) =
        write_experiment_with_performance(&mut connection, &validated, &now)?;
    Ok(ExperimentWithPerformanceDto {
        experiment: get_experiment_by_id(&connection, &experiment_id)?,
        result: get_performance_result_by_id(&connection, &result_id)?,
    })
}

#[cfg(test)]
mod atomic_save_tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn code_of(message: &str) -> String {
        message
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or_default()
            .to_string()
    }

    fn request(json: Value) -> Result<ValidatedExperimentWrite, String> {
        serde_json::from_value::<ExperimentWithPerformanceRequest>(json)
            .expect("the fixture is well-formed JSON")
            .validate()
    }

    #[test]
    fn a_payload_without_a_formulation_is_refused_before_anything_is_written() {
        let error = request(json!({ "testType": "SRV" })).expect_err("a formulation is required");
        assert_eq!(
            code_of(&error),
            crate::commands::errors::VALIDATION_NAME_REQUIRED
        );
    }

    #[test]
    fn a_blank_test_type_is_refused() {
        let error = request(json!({ "formulationId": "f-1", "testType": "   " }))
            .expect_err("a test type is required");
        assert_eq!(
            code_of(&error),
            crate::commands::errors::VALIDATION_NAME_REQUIRED
        );
    }

    #[test]
    fn a_fractional_repeat_count_is_refused() {
        let error = request(json!({
            "formulationId": "f-1",
            "testType": "SRV",
            "repeatCount": 2.5
        }))
        .expect_err("half a repetition is not a repetition");
        assert_eq!(
            code_of(&error),
            crate::commands::errors::VALIDATION_REPEAT_COUNT_INVALID
        );
    }

    #[test]
    fn a_negative_duration_is_refused() {
        let error = request(json!({
            "formulationId": "f-1",
            "testType": "SRV",
            "durationValue": -30
        }))
        .expect_err("a test cannot run backwards");
        assert_eq!(
            code_of(&error),
            crate::commands::errors::VALIDATION_TIME_NEGATIVE
        );
    }

    #[test]
    fn both_rows_are_written_together() {
        let mut connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute(
                "INSERT INTO formulations (id, name, created_at, updated_at)
                 VALUES ('f-1', 'Blend', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("formulation should insert");

        let validated = request(json!({
            "formulationId": "f-1",
            "testType": "SRV",
            "averageFrictionCoefficient": 0.08,
            "repeatCount": 3
        }))
        .expect("the payload is valid");
        let (experiment_id, result_id) =
            write_experiment_with_performance(&mut connection, &validated, "2026-02-01")
                .expect("both rows should be written");

        let linked: String = connection
            .query_row(
                "SELECT experiment_id FROM performance_results WHERE id = ?1",
                params![&result_id],
                |row| row.get(0),
            )
            .expect("the result should exist");
        assert_eq!(linked, experiment_id);
    }

    #[test]
    fn a_missing_formulation_is_reported_rather_than_left_to_sqlite() {
        let mut connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        let validated =
            request(json!({ "formulationId": "nope", "testType": "SRV" })).expect("valid payload");

        let error = write_experiment_with_performance(&mut connection, &validated, "2026-02-01")
            .expect_err("a missing formulation is refused");
        assert_eq!(code_of(&error), crate::commands::errors::RECORD_NOT_FOUND);
    }
}
