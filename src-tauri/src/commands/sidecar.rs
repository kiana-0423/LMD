use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::errors::{
    coded, SIDECAR_COMMAND_FAILED, SIDECAR_PROTOCOL_FAILED, SIDECAR_TIMEOUT, SIDECAR_UNAVAILABLE,
};
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct SidecarOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// The most sidecar stdout this process will hold in memory.
///
/// Generous, because it has to be: a descriptor batch returns roughly 1,800 Mordred values per
/// molecule, and a five-hundred-molecule batch is a legitimate request. But not unbounded — a
/// sidecar caught in a loop writing to stdout would otherwise grow this buffer until the desktop
/// application is killed by the operating system, which looks to a user exactly like a crash with
/// no cause.
const MAX_STDOUT_BYTES: usize = 128 * 1024 * 1024;

/// Diagnostics only, so a much smaller cap. What matters in stderr is the first failure, and that
/// arrives long before this limit.
const MAX_STDERR_BYTES: usize = 1024 * 1024;

/// Appends up to `limit` bytes, reporting whether anything had to be dropped.
fn append_capped(buffer: &mut Vec<u8>, mut bytes: Vec<u8>, limit: usize) -> bool {
    if buffer.len() >= limit {
        return true;
    }
    let room = limit - buffer.len();
    if bytes.len() > room {
        bytes.truncate(room);
        buffer.append(&mut bytes);
        return true;
    }
    buffer.append(&mut bytes);
    false
}

pub async fn run_sidecar_command(
    app: &AppHandle,
    command_name: &str,
    input: Value,
) -> Result<Value, String> {
    let input_path = runtime_file_path(app, "input", "json")
        .map_err(|err| coded(SIDECAR_COMMAND_FAILED, err))?;
    fs::write(
        &input_path,
        serde_json::to_vec(&input).map_err(|err| {
            coded(
                SIDECAR_PROTOCOL_FAILED,
                format!("Failed to serialize sidecar input: {err}"),
            )
        })?,
    )
    .map_err(|err| {
        coded(
            SIDECAR_COMMAND_FAILED,
            format!("Failed to write sidecar input file: {err}"),
        )
    })?;
    set_private_file_permissions(&input_path).map_err(|err| coded(SIDECAR_COMMAND_FAILED, err))?;
    // Removed when this call returns, by whichever path; a removal failure is logged rather than
    // discarded.
    let _cleanup = crate::commands::tempfile::TempFile::claim(&input_path);

    let output = run_packaged_sidecar(app, command_name, &input_path).await?;

    let stdout = String::from_utf8(output.stdout).map_err(|err| {
        coded(
            SIDECAR_PROTOCOL_FAILED,
            format!("Sidecar stdout is not UTF-8: {err}"),
        )
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let parsed: Value = match serde_json::from_str(stdout.trim()) {
        Ok(parsed) => parsed,
        Err(err) if !output.success => {
            return Err(coded(
                SIDECAR_COMMAND_FAILED,
                format!(
                    "Python sidecar command {command_name} exited without a valid response: {err}. stderr: {stderr}. stdout: {stdout}"
                ),
            ));
        }
        Err(err) => {
            return Err(coded(
                SIDECAR_PROTOCOL_FAILED,
                format!(
                    "Failed to parse sidecar JSON for command {command_name}: {err}. stderr: {stderr}. stdout: {stdout}"
                ),
            ));
        }
    };
    if parsed.get("ok").and_then(Value::as_bool) == Some(true) && output.success {
        Ok(parsed)
    } else {
        Err(sidecar_error(&parsed, command_name, &stderr))
    }
}

/// Preserves the sidecar's stable error code while keeping compatibility with an older string
/// envelope. Tauri commands currently reject with strings, so the structured Python error is
/// encoded in the same `[code] detail` contract used by native Rust failures.
fn sidecar_error(parsed: &Value, command_name: &str, stderr: &str) -> String {
    let error = parsed.get("error");
    if let Some(error) = error.and_then(Value::as_object) {
        if let Some(code) = error.get("code").and_then(Value::as_str) {
            let detail = error
                .get("detail")
                .and_then(Value::as_str)
                .filter(|detail| !detail.trim().is_empty())
                .unwrap_or("Python sidecar command failed");
            return coded(code, detail);
        }
    }
    if let Some(detail) = error.and_then(Value::as_str) {
        return detail.to_string();
    }
    let detail = if stderr.trim().is_empty() {
        format!("Python sidecar command {command_name} failed without a diagnostic.")
    } else {
        format!(
            "Python sidecar command {command_name} failed: {}",
            stderr.trim()
        )
    };
    coded(SIDECAR_COMMAND_FAILED, detail)
}

async fn run_packaged_sidecar(
    app: &AppHandle,
    command_name: &str,
    input_path: &std::path::Path,
) -> Result<SidecarOutput, String> {
    let input_path = input_path.to_str().ok_or_else(|| {
        coded(
            SIDECAR_COMMAND_FAILED,
            "Sidecar input path is not valid UTF-8",
        )
    })?;
    let command = app
        .shell()
        .sidecar("lmd-sidecar")
        .map_err(|err| {
            coded(
                SIDECAR_UNAVAILABLE,
                format!("Failed to resolve packaged sidecar: {err}"),
            )
        })?
        .args([command_name, "--input", input_path]);
    let (mut events, child) = command.spawn().map_err(|err| {
        // A sidecar that will not start is the failure this log exists for: it happens before any
        // result reaches the interface, and the message is the only thing that identifies it.
        crate::commands::diagnostics::log_event(
            app,
            crate::commands::diagnostics::LogLevel::Error,
            "sidecar.launchFailed",
            json!({ "command": command_name, "error": err.to_string() }),
        );
        coded(
            SIDECAR_UNAVAILABLE,
            format!("Failed to launch packaged sidecar: {err}"),
        )
    })?;
    let collect_output = async {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;
        let mut truncated = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(mut bytes) => {
                    bytes.push(b'\n');
                    truncated |= append_capped(&mut stdout, bytes, MAX_STDOUT_BYTES);
                }
                CommandEvent::Stderr(mut bytes) => {
                    bytes.push(b'\n');
                    // A flood of stderr is not a reason to abandon a command that is still
                    // producing a usable answer, so this is capped but not reported as truncation.
                    append_capped(&mut stderr, bytes, MAX_STDERR_BYTES);
                }
                CommandEvent::Terminated(payload) => exit_code = payload.code,
                CommandEvent::Error(error) => {
                    let mut bytes = error.into_bytes();
                    bytes.push(b'\n');
                    append_capped(&mut stderr, bytes, MAX_STDERR_BYTES);
                }
                _ => {}
            }
        }
        (exit_code, stdout, stderr, truncated)
    };
    let (exit_code, stdout, stderr, truncated) =
        match tokio::time::timeout(sidecar_timeout(command_name), collect_output).await {
            Ok(output) => output,
            Err(_) => {
                let _ = child.kill();
                return Err(coded(
                    SIDECAR_TIMEOUT,
                    format!(
                        "Packaged sidecar command {command_name} timed out after {} seconds.",
                        sidecar_timeout(command_name).as_secs()
                    ),
                ));
            }
        };

    if truncated {
        // Reported rather than parsed: a truncated JSON document would fail with a syntax error
        // that says nothing about why, and a caller has no way to know the answer was incomplete.
        return Err(coded(
            SIDECAR_PROTOCOL_FAILED,
            format!(
                "Packaged sidecar command {command_name} produced more than {} MB of output; the \
                 response was discarded rather than truncated.",
                MAX_STDOUT_BYTES / (1024 * 1024)
            ),
        ));
    }

    Ok(SidecarOutput {
        success: exit_code == Some(0),
        stdout,
        stderr,
    })
}

fn sidecar_timeout(command_name: &str) -> Duration {
    match command_name {
        // A frozen SHAP runtime loads additional native libraries. Its first macOS
        // health probe can exceed two minutes while those libraries are validated.
        "health" => Duration::from_secs(300),
        "calculate-required-descriptors"
        | "calculate-descriptor-batch"
        | "calculate-sketcher-descriptors"
        | "mordred-descriptors"
        | "generate-3d"
        | "train-model"
        | "predict-with-model"
        | "describe-model"
        | "explain-model"
        | "explain-model-example"
        // The composite command does the work of five, so it carries the longest of their
        // deadlines rather than the default.
        | "prepare-molecule"
        | "export-table-rows" => Duration::from_secs(300),
        _ => Duration::from_secs(120),
    }
}

pub fn runtime_file_path(
    app: &AppHandle,
    prefix: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let directory = default_workspace_dir(app)?.join(".runtime");
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Failed to create private sidecar runtime directory: {err}"))?;
    Ok(directory.join(format!("lmd-{prefix}-{}.{}", Uuid::new_v4(), extension)))
}

#[cfg(unix)]
pub fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|err| format!("Failed to protect sidecar runtime file: {err}"))
}

#[cfg(not(unix))]
pub fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// One molecule's worth of sidecar work, from one process.
///
/// The fields are shaped like the responses of the individual commands they replace, so the
/// callers that assemble a molecule record read exactly what they read before. What changed is the
/// number of processes started to produce them: one instead of five.
pub struct PreparedMolecule {
    /// Canonical SMILES, InChI, InChIKey, formula, molecular weight.
    pub identifiers: Value,
    /// `{ "svg": ... }`, as `visualize` returned.
    pub visualization: Value,
    /// `{ "molfile": ... }`, as `smiles-to-molfile` returned.
    pub molfile: Value,
    /// The 3D blocks, or an empty object when 3D was not requested or could not be embedded.
    pub three_d: Value,
    /// `{ "rdkit": …, "mordred": …, "smiles_canonical": … }`, as
    /// `calculate-required-descriptors` returned.
    pub descriptors: Value,
    /// Anything the sidecar wanted the user to know — a 3D embedding that did not converge, for
    /// instance, which is a warning rather than a failure of the whole save.
    pub warnings: Vec<String>,
}

/// Runs the composite command and splits its response into the shapes the callers expect.
pub async fn prepare_molecule_with_sidecar(
    app: &AppHandle,
    smiles: &str,
    include_3d: bool,
) -> Result<PreparedMolecule, String> {
    let response = run_sidecar_command(
        app,
        "prepare-molecule",
        json!({
            "smiles": smiles,
            "include_svg": true,
            "include_molfile": true,
            "include_3d": include_3d,
            "require_rdkit": true,
            "require_mordred": true,
            "force_field": "MMFF"
        }),
    )
    .await?;

    let data = response.get("data").cloned().ok_or_else(|| {
        coded(
            SIDECAR_PROTOCOL_FAILED,
            "prepare-molecule returned no data.",
        )
    })?;
    let warnings = response
        .get("warnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let pick = |keys: &[&str]| -> Value {
        let mut object = serde_json::Map::new();
        for key in keys {
            if let Some(value) = data.get(*key) {
                object.insert((*key).to_string(), value.clone());
            }
        }
        Value::Object(object)
    };

    Ok(PreparedMolecule {
        identifiers: pick(&[
            "smiles_raw",
            "smiles_canonical",
            "inchi",
            "inchi_key",
            "formula",
            "molecular_weight",
            "mode",
        ]),
        visualization: pick(&["svg"]),
        molfile: pick(&["molfile"]),
        // `three_d` is null when the embedding failed; an empty object is what the callers already
        // handle for "no 3D structure", so the two cases stay indistinguishable downstream.
        three_d: data
            .get("three_d")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
        descriptors: pick(&["rdkit", "mordred", "smiles_canonical"]),
        warnings,
    })
}

#[tauri::command]
pub async fn validate_smiles_with_sidecar(app: AppHandle, smiles: String) -> Result<Value, String> {
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
) -> Result<Value, String> {
    run_sidecar_command(
        &app,
        "calculate-sketcher-descriptors",
        json!({ "smiles": smiles }),
    )
    .await
}

/// What the preview stage found, before anything was written.
///
/// The import used to be one command: preview *and* write, in a single call, with the preview rows
/// returned afterwards as though the user had been shown them first. By the time anyone saw the
/// detected type or the warnings, the rows were already in the database.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_path: String,
    pub file_name: String,
    /// `base_oils`, `additives`, or `preview_only` when nothing recognisable was found.
    pub detected_kind: String,
    pub columns: Vec<String>,
    pub preview_rows: Vec<Value>,
    pub sheet_names: Vec<String>,
    /// Whether confirming would write anything at all.
    pub importable: bool,
    pub warnings: Vec<String>,
    /// Identifies the exact bytes that were previewed; see `file_fingerprint`.
    pub fingerprint: String,
}

/// One row that was read but not stored, and why.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedRow {
    /// One-based, counting data rows as the file presents them.
    pub row: i64,
    pub reason: String,
}

/// What the confirmed import actually did.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub import_kind: String,
    pub imported_count: i64,
    pub skipped_count: i64,
    pub created_molecule_count: i64,
    pub rejected: Vec<RejectedRow>,
    pub warnings: Vec<String>,
}

/// Identifies a file by its size and modification time.
///
/// Between the preview and the confirmation, the file on disk can change — a spreadsheet left open
/// and saved again is enough. Importing the new contents against a preview of the old ones would
/// write rows nobody reviewed, so the fingerprint is checked and a mismatch is refused.
fn file_fingerprint(path: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(path).map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(format!("{}-{modified}", metadata.len()))
}

/// Reads a file and reports what an import would do. Writes nothing.
#[tauri::command]
pub async fn preview_table_import(
    app: AppHandle,
    file_path: String,
) -> Result<ImportPreview, String> {
    let path = PathBuf::from(&file_path);
    let fingerprint = file_fingerprint(&path)?;
    let response = run_sidecar_command(
        &app,
        "import-excel",
        json!({ "file_path": &file_path, "preview_rows": 20 }),
    )
    .await?;

    let data = response
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            coded(
                SIDECAR_PROTOCOL_FAILED,
                "The import preview returned no data object.",
            )
        })?;
    let columns: Vec<String> = data
        .get("columns")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let preview_rows: Vec<Value> = data
        .get("preview_rows")
        .or_else(|| data.get("rows"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sheet_names: Vec<String> = data
        .get("sheet_names")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let lowered: Vec<String> = columns
        .iter()
        .map(|column| column.to_ascii_lowercase())
        .collect();
    let detected_kind = detect_import_kind(&lowered, &preview_rows);

    let mut warnings: Vec<String> = response
        .get("warnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if detected_kind == "preview_only" {
        // Not an error: a file can legitimately be inspected without being importable. Saying so
        // here is what stops a user pressing Import and being told nothing happened.
        warnings.push(
            "No base oil or additive columns were recognised, so confirming would import nothing."
                .to_string(),
        );
    }
    if preview_rows.is_empty() {
        warnings.push("The file contains no data rows.".to_string());
    }

    Ok(ImportPreview {
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone()),
        file_path,
        detected_kind: detected_kind.clone(),
        columns,
        preview_rows,
        sheet_names,
        importable: detected_kind != "preview_only",
        warnings,
        fingerprint,
    })
}

/// Writes the rows the user reviewed, in one transaction, or none of them.
#[tauri::command]
pub async fn confirm_table_import(
    app: AppHandle,
    file_path: String,
    fingerprint: String,
    detected_kind: String,
) -> Result<ImportOutcome, String> {
    let path = PathBuf::from(&file_path);
    let current = file_fingerprint(&path)?;
    if current != fingerprint {
        return Err(coded(
            crate::commands::errors::IMPORT_PREVIEW_STALE,
            format!(
                "{} changed after it was previewed, so nothing was imported. Preview it again.",
                path.display()
            ),
        ));
    }
    if detected_kind != "base_oils" && detected_kind != "additives" {
        return Err(coded(
            crate::commands::errors::VALIDATION_PAYLOAD_EMPTY,
            format!("Nothing in {} can be imported as a record.", path.display()),
        ));
    }

    let staging_path = runtime_file_path(&app, "import", "jsonl")?;
    File::create(&staging_path)
        .map_err(|err| format!("Failed to create import staging file: {err}"))?;
    set_private_file_permissions(&staging_path)?;
    let _cleanup = crate::commands::tempfile::TempFile::claim(&staging_path);

    let export_result = run_sidecar_command(
        &app,
        "export-table-rows",
        json!({
            "file_path": &file_path,
            "output_path": staging_path,
            "chunk_size": 500
        }),
    )
    .await?;
    let exported_count = export_result
        .get("data")
        .and_then(|value| value.get("row_count"))
        .and_then(Value::as_i64)
        .unwrap_or_default();

    let staging_file = File::open(&staging_path)
        .map_err(|err| format!("Failed to open import staging file: {err}"))?;
    let mut connection = open_database(default_database_path(&app)?)
        .map_err(|err| format!("Failed to open SQLite database for import: {err}"))?;
    let mut summary = import_jsonl_rows(
        &mut connection,
        &file_path,
        &detected_kind,
        BufReader::new(staging_file),
    )?;
    if summary.imported_count + summary.skipped_count != exported_count {
        summary.warn(format!(
            "The sidecar exported {exported_count} rows, but Rust processed {}.",
            summary.imported_count + summary.skipped_count
        ));
    }

    Ok(ImportOutcome {
        import_kind: summary.import_kind.clone(),
        imported_count: summary.imported_count,
        skipped_count: summary.skipped_count,
        created_molecule_count: summary.created_molecule_count,
        rejected: std::mem::take(&mut summary.rejected),
        warnings: summary.into_warnings(),
    })
}

/// A wholly malformed file would otherwise return one warning string per row.
const MAX_IMPORT_WARNINGS: usize = 50;

#[derive(Debug, Default)]
struct ImportSummary {
    import_kind: String,
    imported_count: i64,
    skipped_count: i64,
    created_molecule_count: i64,
    /// Every row that was read and not stored, with the reason. A count alone tells a user that
    /// something was wrong but not which row or why, which is not actionable.
    rejected: Vec<RejectedRow>,
    warnings: Vec<String>,
    suppressed_warning_count: i64,
}

impl ImportSummary {
    fn reject(&mut self, row: i64, reason: String) {
        self.skipped_count += 1;
        if self.rejected.len() < MAX_IMPORT_WARNINGS {
            self.rejected.push(RejectedRow { row, reason });
        } else {
            self.suppressed_warning_count += 1;
        }
    }

    fn warn(&mut self, warning: String) {
        if self.warnings.len() < MAX_IMPORT_WARNINGS {
            self.warnings.push(warning);
        } else {
            self.suppressed_warning_count += 1;
        }
    }

    fn into_warnings(mut self) -> Vec<String> {
        if self.suppressed_warning_count > 0 {
            let suppressed = self.suppressed_warning_count;
            self.warnings.push(format!(
                "{suppressed} further row warnings were not listed."
            ));
        }
        self.warnings
    }
}

fn import_jsonl_rows<R: BufRead>(
    connection: &mut Connection,
    file_path: &str,
    import_kind: &str,
    reader: R,
) -> Result<ImportSummary, String> {
    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start import transaction: {err}"))?;
    let mut summary = ImportSummary {
        import_kind: import_kind.to_string(),
        ..ImportSummary::default()
    };

    for (index, line) in reader.lines().enumerate() {
        let line = line.map_err(|err| format!("Failed to read import row {}: {err}", index + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        let row: Value = serde_json::from_str(&line)
            .map_err(|err| format!("Failed to parse import row {}: {err}", index + 1))?;
        let row_number = index as i64 + 1;
        let Some(row) = row.as_object() else {
            summary.reject(row_number, "The row is not an object.".to_string());
            continue;
        };
        let imported = if import_kind == "base_oils" {
            import_base_oil_row(&tx, row, file_path, &mut summary)
        } else {
            import_additive_row(&tx, row, file_path, &mut summary)
        };
        if let Err(err) = imported {
            summary.reject(row_number, err);
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

fn molecule_exists(tx: &rusqlite::Transaction<'_>, molecule_id: &str) -> Result<bool, String> {
    tx.query_row(
        "SELECT 1 FROM molecules WHERE id = ?1",
        params![molecule_id],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(|err| format!("Failed to inspect molecule {molecule_id}: {err}"))
}

fn import_base_oil_row(
    tx: &rusqlite::Transaction<'_>,
    row: &serde_json::Map<String, Value>,
    file_path: &str,
    summary: &mut ImportSummary,
) -> Result<(), String> {
    let name = field_string(row, &["name", "base_oil_name"])
        .ok_or_else(|| "Skipped base oil row without name.".to_string())?;
    let id =
        field_string(row, &["id", "base_oil_id"]).unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    // `representative_molecule_id` is a foreign key. Writing an id the library does not hold
    // would fail the whole row, so drop the link and say so instead. Unlike the additive path
    // there is nothing here to build a molecule from — a base oil row describes an oil, not a
    // structure.
    let representative_molecule_id = match field_string(
        row,
        &["representative_molecule_id", "molecule_id"],
    ) {
        Some(molecule_id) if !molecule_exists(tx, &molecule_id)? => {
            summary.warn(format!(
                    "Base oil {id}: molecule {molecule_id} is not in the library, so the row was imported without a representative molecule."
                ));
            None
        }
        other => other,
    };
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
            representative_molecule_id,
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
    let additive_id =
        field_string(row, &["id", "additive_id"]).unwrap_or_else(|| Uuid::new_v4().to_string());
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
            list_json(
                row,
                &["function_types", "additive_function_tags", "functions"]
            ),
            list_json(row, &["active_elements", "elements"]),
            field_f64(row, &["typical_concentration_min", "concentration_min"]),
            field_f64(row, &["typical_concentration_max", "concentration_max"]),
            field_string(row, &["concentration_unit"]).unwrap_or_else(|| "wt%".to_string()),
            list_json(row, &["compatible_base_oils", "compatible_base_oil"]),
            field_string(row, &["application_notes", "notes"])
                .unwrap_or_else(|| format!("Imported from {file_path}")),
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
        create_minimal_molecule(
            tx,
            row,
            file_path,
            Some(format!("mol-{additive_id}")),
            summary,
        )
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
        .or_else(|| {
            if smiles.is_empty() {
                None
            } else {
                Some(smiles.clone())
            }
        })
        .ok_or_else(|| {
            "Skipped additive row without molecule_id, molecule_name, or smiles.".to_string()
        })?;
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
        Value::Array(items) => items.iter().filter_map(field_value_to_string).collect(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;
    use std::io::Cursor;

    #[test]
    fn structured_sidecar_error_keeps_code_and_detail() {
        let parsed = json!({
            "ok": false,
            "error": {
                "code": "model.trainingFailed",
                "params": {"command": "train-model"},
                "detail": "At least three rows are required."
            }
        });

        let error = sidecar_error(&parsed, "train-model", "");

        assert_eq!(
            error,
            "[model.trainingFailed] At least three rows are required."
        );
    }

    #[test]
    fn legacy_sidecar_error_string_remains_readable() {
        let parsed = json!({"ok": false, "error": "Invalid SMILES."});

        assert_eq!(sidecar_error(&parsed, "standardize", ""), "Invalid SMILES.");
    }

    #[test]
    fn streamed_import_ingests_every_row_not_only_the_preview() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        let rows = (0..25)
            .map(|index| {
                json!({
                    "id": format!("oil-{index}"),
                    "name": format!("Base oil {index}"),
                    "base_oil_type": "PAO",
                    "viscosity_40c": index
                })
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");

        let summary = import_jsonl_rows(
            &mut connection,
            "base-oils.csv",
            "base_oils",
            Cursor::new(rows),
        )
        .expect("all rows should import");
        let stored: i64 = connection
            .query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0))
            .expect("base oil count should be readable");

        assert_eq!(summary.imported_count, 25);
        assert_eq!(summary.skipped_count, 0);
        assert_eq!(stored, 25);
    }

    #[test]
    fn malformed_staging_data_rolls_back_the_whole_import() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        let rows = "{\"id\":\"oil-1\",\"name\":\"Valid\",\"base_oil_type\":\"PAO\"}\nnot-json";

        let error = import_jsonl_rows(
            &mut connection,
            "base-oils.csv",
            "base_oils",
            Cursor::new(rows),
        )
        .expect_err("malformed staging data should fail");
        let stored: i64 = connection
            .query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0))
            .expect("base oil count should be readable");

        assert!(error.contains("Failed to parse import row 2"));
        assert_eq!(stored, 0);
    }
}

#[cfg(test)]
mod output_limit_tests {
    use super::*;

    #[test]
    fn output_within_the_limit_is_kept_whole() {
        let mut buffer = Vec::new();
        let truncated = append_capped(&mut buffer, b"hello".to_vec(), 100);
        assert!(!truncated);
        assert_eq!(buffer, b"hello");
    }

    #[test]
    fn output_past_the_limit_is_reported_rather_than_silently_dropped() {
        let mut buffer = Vec::new();
        // The first chunk fills the buffer exactly; the second has nowhere to go.
        assert!(!append_capped(&mut buffer, b"1234".to_vec(), 8));
        assert!(append_capped(&mut buffer, b"56789".to_vec(), 8));
        assert_eq!(buffer.len(), 8);
    }

    #[test]
    fn a_chunk_that_starts_past_the_limit_adds_nothing() {
        let mut buffer = vec![b'x'; 8];
        assert!(append_capped(&mut buffer, b"more".to_vec(), 8));
        assert_eq!(buffer.len(), 8, "a full buffer does not grow");
    }

    #[test]
    fn the_stdout_cap_is_large_enough_for_a_real_descriptor_batch() {
        // Roughly 1,800 Mordred descriptors per molecule at ~35 bytes each, five hundred
        // molecules: the largest batch the interface can request.
        let realistic_batch = 500 * 1_800 * 35;
        assert!(
            MAX_STDOUT_BYTES > realistic_batch,
            "the cap must not refuse work the application legitimately asks for"
        );
    }

    #[test]
    fn every_long_running_command_has_a_deadline_longer_than_the_default() {
        // The composite command does the work of five, so inheriting the 120-second default would
        // have made it time out on exactly the molecules it was written to speed up.
        assert!(sidecar_timeout("prepare-molecule") > sidecar_timeout("standardize"));
        assert!(sidecar_timeout("explain-model") > sidecar_timeout("standardize"));
        assert!(sidecar_timeout("health") >= sidecar_timeout("explain-model"));
        assert_eq!(
            sidecar_timeout("train-model"),
            sidecar_timeout("explain-model")
        );
        assert_eq!(
            sidecar_timeout("prepare-molecule"),
            sidecar_timeout("calculate-required-descriptors")
        );
    }
}
