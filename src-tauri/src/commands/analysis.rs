use crate::app_paths::default_database_path;
use crate::commands::ok;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummaryDto {
    pub molecule_count: i64,
    pub base_oil_count: i64,
    pub additive_count: i64,
    pub formulation_count: i64,
    pub formulation_component_count: i64,
    pub experiment_count: i64,
    pub performance_result_count: i64,
    pub attachment_count: i64,
    pub data_source_count: i64,
    pub job_count: i64,
    pub running_job_count: i64,
    pub failed_job_count: i64,
    pub descriptor_record_count: i64,
    pub descriptor_ready_count: i64,
    pub descriptor_failed_count: i64,
    pub descriptor_pending_count: i64,
    pub descriptor_mock_count: i64,
    pub descriptor_real_count: i64,
}

#[tauri::command]
pub fn get_dashboard_summary(app: AppHandle) -> Result<DashboardSummaryDto, String> {
    let db_path = default_database_path(&app)?;
    let connection = Connection::open(db_path)
        .map_err(|err| format!("Failed to open SQLite database for dashboard summary: {err}"))?;

    Ok(DashboardSummaryDto {
        molecule_count: count(&connection, "molecules")?,
        base_oil_count: count(&connection, "base_oils")?,
        additive_count: count(&connection, "additives")?,
        formulation_count: count(&connection, "formulations")?,
        formulation_component_count: count(&connection, "formulation_components")?,
        experiment_count: count(&connection, "experiments")?,
        performance_result_count: count(&connection, "performance_results")?,
        attachment_count: count(&connection, "attachments")?,
        data_source_count: count(&connection, "data_sources")?,
        job_count: count(&connection, "jobs")?,
        running_job_count: count_where(&connection, "jobs", "status IN ('running', 'pending')")?,
        failed_job_count: count_where(&connection, "jobs", "status = 'failed'")?,
        descriptor_record_count: count(&connection, "molecule_descriptors")?,
        descriptor_ready_count: count_where(&connection, "molecules", "descriptor_ready = 1")?,
        descriptor_failed_count: count_where(
            &connection,
            "molecule_descriptors",
            "status = 'failed'",
        )?,
        descriptor_pending_count: count_where(
            &connection,
            "molecule_descriptors",
            "status IN ('pending', '') OR status IS NULL",
        )?,
        descriptor_mock_count: count_where(&connection, "molecule_descriptors", "mode = 'mock'")?,
        descriptor_real_count: count_where(&connection, "molecule_descriptors", "mode = 'real'")?,
    })
}

#[tauri::command]
pub fn get_performance_distribution() -> Result<Value, String> {
    ok("get_performance_distribution", json!({ "series": [] }))
}

#[tauri::command]
pub fn get_descriptor_property_correlation() -> Result<Value, String> {
    ok(
        "get_descriptor_property_correlation",
        json!({ "pearson": null, "spearman": null }),
    )
}

#[tauri::command]
pub fn export_ml_dataset(filter: Option<Value>) -> Result<Value, String> {
    ok(
        "export_ml_dataset",
        json!({ "filter": filter, "status": "mock_csv_ready" }),
    )
}

#[tauri::command]
pub fn run_additive_design_mock(payload: Value) -> Result<Value, String> {
    ok(
        "run_additive_design_mock",
        json!({ "payload": payload, "candidates": [] }),
    )
}

#[tauri::command]
pub fn run_formulation_design_mock(payload: Value) -> Result<Value, String> {
    ok(
        "run_formulation_design_mock",
        json!({ "payload": payload, "recommendations": [] }),
    )
}

fn count(connection: &Connection, table: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .map_err(|err| format!("Failed to count {table}: {err}"))
}

fn count_where(connection: &Connection, table: &str, condition: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {condition}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .map_err(|err| format!("Failed to count {table} where {condition}: {err}"))
}
