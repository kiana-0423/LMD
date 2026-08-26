//! A structured, rotating log and a report a user can send when something is wrong.
//!
//! The failures this exists for are the ones that leave nothing on screen worth quoting: the
//! packaged sidecar that will not start, the workspace database that refuses to open. Both happen
//! before any interface is drawn, and both produce a message the user has no way to capture.
//!
//! What it deliberately does *not* record is the science. A molecule's structure, a descriptor
//! table, a fitted model, the contents of a spreadsheet somebody imported — none of it helps
//! diagnose a startup failure, and all of it is the user's unpublished work. The report carries
//! versions, paths, counts and error messages, and nothing else. Home directories are replaced by
//! `~` so a path can be read without naming the person who owns it.

use crate::app_paths::{app_data_dir, default_database_path, default_workspace_dir};
use crate::commands::errors::{self, coded};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// How large one log file grows before it is rotated.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
/// How many rotated files are kept. Bounded: a log folder that grows forever is a bug, not a
/// feature, on a machine whose disk is full enough to have caused the problem being logged.
const KEPT_LOG_FILES: usize = 5;
const LOG_FILE: &str = "lmd.log";

/// What a log line is about, so a reader can filter without parsing prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// The folder log files are written to.
pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app_data_dir(app)?.join("logs");
    fs::create_dir_all(&directory).map_err(|err| {
        coded(
            errors::WORKSPACE_UNUSABLE,
            format!("Failed to create the log folder: {err}"),
        )
    })?;
    Ok(directory)
}

/// Replaces the user's home directory with `~`.
///
/// A path is often the whole diagnostic — a workspace on a network share, a sidecar that is not
/// where it should be — so it cannot be dropped. It can be reported without the person's name in
/// it, and that is the compromise this makes.
pub fn redact_path(path: &str, home: Option<&str>) -> String {
    match home {
        Some(home) if !home.is_empty() && path.starts_with(home) => {
            format!("~{}", &path[home.len()..])
        }
        _ => path.to_string(),
    }
}

fn home_directory() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .filter(|value| !value.is_empty())
}

/// One structured line, appended to the current log file.
///
/// `details` is for machine-readable context — a command name, an exit code, a count. Anything a
/// caller puts here ends up in an exported report, so it must not carry scientific data; the
/// call sites in this crate pass identifiers and numbers only.
pub fn log_event(app: &AppHandle, level: LogLevel, event: &str, details: Value) {
    // A logging failure must never become the failure the user sees. It is reported to stderr,
    // where a developer running the binary directly will see it, and otherwise ignored.
    if let Err(err) = write_event(app, level, event, details) {
        eprintln!("LMD: could not write a log entry: {err}");
    }
}

fn write_event(
    app: &AppHandle,
    level: LogLevel,
    event: &str,
    details: Value,
) -> Result<(), String> {
    let directory = log_dir(app)?;
    let path = directory.join(LOG_FILE);
    rotate_if_needed(&path)?;

    let home = home_directory();
    let line = json!({
        "at": Utc::now().to_rfc3339(),
        "level": level.as_str(),
        "event": event,
        "details": redact_values(&details, home.as_deref()),
    });
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| format!("Failed to open the log file: {err}"))?;
    writeln!(file, "{line}").map_err(|err| format!("Failed to append a log entry: {err}"))
}

/// Redacts every string in a JSON value that looks like an absolute path.
fn redact_values(value: &Value, home: Option<&str>) -> Value {
    match value {
        Value::String(text) => Value::String(redact_path(text, home)),
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| redact_values(item, home)).collect())
        }
        Value::Object(entries) => Value::Object(
            entries
                .iter()
                .map(|(key, item)| (key.clone(), redact_values(item, home)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Renames the current log aside when it has grown past the limit, keeping a bounded history.
fn rotate_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(()); // No log yet; nothing to rotate.
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let directory = path.parent().unwrap_or(Path::new("."));
    // Shift 4 -> 5, 3 -> 4, ... so `.1` is always the most recent rotation.
    let oldest = directory.join(format!("{LOG_FILE}.{KEPT_LOG_FILES}"));
    let _ = fs::remove_file(oldest);
    for index in (1..KEPT_LOG_FILES).rev() {
        let from = directory.join(format!("{LOG_FILE}.{index}"));
        let to = directory.join(format!("{LOG_FILE}.{}", index + 1));
        if from.is_file() {
            fs::rename(&from, &to)
                .map_err(|err| format!("Failed to rotate {}: {err}", from.display()))?;
        }
    }
    fs::rename(path, directory.join(format!("{LOG_FILE}.1")))
        .map_err(|err| format!("Failed to rotate the log file: {err}"))
}

/// The report itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub generated_at: String,
    pub application_version: String,
    pub platform: String,
    pub architecture: String,
    pub workspace_path: String,
    pub workspace_exists: bool,
    pub database_path: String,
    pub database_exists: bool,
    pub database_size_bytes: u64,
    pub schema_version: i64,
    pub supported_schema_version: i64,
    pub rows_needing_attention: usize,
    /// Row counts per table. Counts, never contents.
    pub record_counts: Value,
    /// What the packaged sidecar reported about itself, including every dependency version.
    pub sidecar: Value,
    /// The most recent log lines, already redacted.
    pub recent_log: Vec<String>,
    /// Anything that went wrong while assembling the report.
    pub collection_errors: Vec<String>,
}

/// Where an exported report was written.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    pub path: String,
    pub display_path: String,
    pub bytes: u64,
}

/// Builds the report. Every step that can fail is recorded rather than aborting the whole thing —
/// a report that stops at the first problem is least useful exactly when there is a problem.
pub async fn collect_diagnostics(app: &AppHandle) -> DiagnosticsReport {
    let home = home_directory();
    let mut collection_errors = Vec::new();

    let workspace = default_workspace_dir(app).unwrap_or_default();
    let database = default_database_path(app).unwrap_or_default();
    let database_size_bytes = fs::metadata(&database)
        .map(|value| value.len())
        .unwrap_or(0);

    let mut schema_version = 0;
    let mut rows_needing_attention = 0;
    let mut record_counts = json!({});
    if database.is_file() {
        match crate::db::open_database(&database) {
            Ok(connection) => {
                schema_version = connection
                    .pragma_query_value(None, "user_version", |row| row.get(0))
                    .unwrap_or(0);
                match crate::db::migrations::data_quality_issues(&connection) {
                    Ok(issues) => rows_needing_attention = issues.len(),
                    Err(err) => collection_errors.push(err),
                }
                let mut counts = serde_json::Map::new();
                for table in [
                    "molecules",
                    "molecule_descriptors",
                    "base_oils",
                    "additives",
                    "formulations",
                    "formulation_components",
                    "experiments",
                    "performance_results",
                    "attachments",
                    "models",
                    "jobs",
                ] {
                    match connection.query_row(
                        &format!("SELECT COUNT(*) FROM {table}"),
                        [],
                        |row| row.get::<_, i64>(0),
                    ) {
                        Ok(count) => {
                            counts.insert(table.to_string(), Value::from(count));
                        }
                        Err(err) => collection_errors.push(format!("{table}: {err}")),
                    }
                }
                record_counts = Value::Object(counts);
            }
            Err(err) => {
                collection_errors.push(format!("The workspace database did not open: {err}"))
            }
        }
    }

    // The sidecar's own health answer carries every dependency version, which is exactly the
    // manifest a "it works on my machine" report needs.
    let sidecar =
        match crate::commands::sidecar::run_sidecar_command(app, "health", json!({})).await {
            Ok(response) => response.get("data").cloned().unwrap_or(Value::Null),
            Err(err) => {
                collection_errors.push(err.clone());
                json!({ "error": err })
            }
        };

    let recent_log = read_recent_log(app, 200).unwrap_or_else(|err| {
        collection_errors.push(err);
        Vec::new()
    });

    DiagnosticsReport {
        generated_at: Utc::now().to_rfc3339(),
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        workspace_exists: workspace.is_dir(),
        workspace_path: redact_path(&workspace.to_string_lossy(), home.as_deref()),
        database_exists: database.is_file(),
        database_path: redact_path(&database.to_string_lossy(), home.as_deref()),
        database_size_bytes,
        schema_version,
        supported_schema_version: crate::commands::workspace::SUPPORTED_SCHEMA_VERSION,
        rows_needing_attention,
        record_counts,
        sidecar,
        recent_log,
        collection_errors,
    }
}

fn read_recent_log(app: &AppHandle, limit: usize) -> Result<Vec<String>, String> {
    let path = log_dir(app)?.join(LOG_FILE);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|err| format!("Failed to read the log: {err}"))?;
    let lines: Vec<&str> = text.lines().collect();
    Ok(lines
        .iter()
        .rev()
        .take(limit)
        .rev()
        .map(|line| line.to_string())
        .collect())
}

#[tauri::command]
pub async fn get_diagnostics(app: AppHandle) -> Result<DiagnosticsReport, String> {
    Ok(collect_diagnostics(&app).await)
}

/// Writes the report into the workspace's `exports/` folder.
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle) -> Result<DiagnosticsExport, String> {
    let report = collect_diagnostics(&app).await;
    let workspace = default_workspace_dir(&app)?;
    let directory = workspace.join("exports");
    fs::create_dir_all(&directory).map_err(|err| {
        coded(
            errors::WORKSPACE_UNUSABLE,
            format!("Failed to create the exports folder: {err}"),
        )
    })?;
    let stamp = Utc::now().to_rfc3339().replace([':', '.'], "-");
    let path = directory.join(format!("lmd-diagnostics-{stamp}.json"));
    let body = serde_json::to_string_pretty(&report)
        .map_err(|err| format!("Failed to serialize the diagnostics report: {err}"))?;
    fs::write(&path, &body).map_err(|err| format!("Failed to write the report: {err}"))?;

    log_event(
        &app,
        LogLevel::Info,
        "diagnostics.exported",
        json!({ "bytes": body.len() }),
    );

    Ok(DiagnosticsExport {
        display_path: redact_path(&path.to_string_lossy(), home_directory().as_deref()),
        path: path.to_string_lossy().to_string(),
        bytes: body.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn a_home_directory_is_replaced_by_a_tilde() {
        assert_eq!(
            redact_path(
                "/Users/someone/LMD_Workspace/lmd.sqlite",
                Some("/Users/someone")
            ),
            "~/LMD_Workspace/lmd.sqlite"
        );
    }

    #[test]
    fn a_path_outside_the_home_directory_is_left_alone() {
        // A workspace on a shared volume is often the whole diagnostic; truncating it would
        // remove the information the report exists to carry.
        assert_eq!(
            redact_path("/Volumes/Lab/LMD", Some("/Users/someone")),
            "/Volumes/Lab/LMD"
        );
        assert_eq!(redact_path("/Volumes/Lab/LMD", None), "/Volumes/Lab/LMD");
    }

    #[test]
    fn every_string_in_a_nested_value_is_redacted() {
        let value = json!({
            "workspace": "/Users/someone/LMD",
            "files": ["/Users/someone/a.csv", "/tmp/b.csv"],
            "count": 3
        });

        let redacted = redact_values(&value, Some("/Users/someone"));

        assert_eq!(redacted["workspace"], "~/LMD");
        assert_eq!(redacted["files"][0], "~/a.csv");
        assert_eq!(redacted["files"][1], "/tmp/b.csv");
        assert_eq!(redacted["count"], 3);
    }

    #[test]
    fn a_log_file_rotates_once_it_passes_its_limit_and_the_history_stays_bounded() {
        let directory = std::env::temp_dir().join(format!("lmd-log-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("folder should be created");
        let path = directory.join(LOG_FILE);

        for round in 0..(KEPT_LOG_FILES + 3) {
            fs::write(&path, vec![b'x'; (MAX_LOG_BYTES + 1) as usize])
                .expect("log should be written");
            rotate_if_needed(&path).unwrap_or_else(|err| panic!("round {round}: {err}"));
        }

        let rotated = fs::read_dir(&directory)
            .expect("folder should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(LOG_FILE))
            .count();
        assert!(
            rotated <= KEPT_LOG_FILES + 1,
            "the log history must stay bounded, found {rotated} files"
        );
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_log_that_is_still_small_is_not_rotated() {
        let directory = std::env::temp_dir().join(format!("lmd-log-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("folder should be created");
        let path = directory.join(LOG_FILE);
        fs::write(&path, b"one line\n").expect("log should be written");

        rotate_if_needed(&path).expect("rotation should be a no-op");

        assert!(path.is_file());
        assert!(!directory.join(format!("{LOG_FILE}.1")).exists());
        let _ = fs::remove_dir_all(&directory);
    }
}
