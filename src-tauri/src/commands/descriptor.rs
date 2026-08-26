use crate::app_paths::default_database_path;
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

/// Molecules per sidecar process. Mordred computes ~1,800 descriptors per molecule, so a chunk
/// has to stay well inside the sidecar timeout.
const DESCRIPTOR_BATCH_CHUNK_SIZE: usize = 64;

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
pub async fn batch_calculate_descriptors(
    app: AppHandle,
    molecule_ids: Vec<String>,
    descriptor_sets: Vec<String>,
) -> Result<Value, String> {
    let sets = validate_descriptor_sets(&descriptor_sets)?;
    // From here on the request is well-formed, so everything that follows — the database read
    // included — is tracked work. The guard closes the row on every path, including a panic.
    let job = crate::commands::jobs::JobGuard::start(
        open_connection(&app)?,
        "descriptor_batch",
        molecule_ids.len() as i64,
        &json!({
            "requestedCount": molecule_ids.len(),
            "descriptorSets": descriptor_sets,
            "chunkSize": DESCRIPTOR_BATCH_CHUNK_SIZE
        }),
    )?;
    run_descriptor_batch(&app, job, molecule_ids, sets).await
}

/// The two descriptor sets a batch may ask for.
#[derive(Debug, Clone, Copy)]
struct DescriptorSets {
    rdkit: bool,
    mordred: bool,
}

/// Checks the request itself. A malformed request is not work and leaves no job behind.
fn validate_descriptor_sets(descriptor_sets: &[String]) -> Result<DescriptorSets, String> {
    if descriptor_sets
        .iter()
        .any(|item| item != "rdkit" && item != "mordred")
    {
        return Err("Unsupported descriptor set in batch request.".to_string());
    }
    let sets = DescriptorSets {
        rdkit: descriptor_sets.is_empty() || descriptor_sets.iter().any(|item| item == "rdkit"),
        mordred: descriptor_sets.is_empty() || descriptor_sets.iter().any(|item| item == "mordred"),
    };
    if !sets.rdkit && !sets.mordred {
        return Err("descriptor_sets must include rdkit, mordred, or both.".to_string());
    }
    Ok(sets)
}

/// Runs a descriptor batch against an already-open job.
///
/// The job is a parameter rather than something opened here, so a caller that has to query the
/// database to decide *which* molecules to calculate can open the job before that query. A lookup
/// that fails is then recorded as a failed job instead of vanishing.
async fn run_descriptor_batch(
    app: &AppHandle,
    job: crate::commands::jobs::JobGuard,
    molecule_ids: Vec<String>,
    sets: DescriptorSets,
) -> Result<Value, String> {
    job.set_total(molecule_ids.len() as i64)?;

    if molecule_ids.is_empty() {
        // Nothing to recalculate is a legitimate outcome, not an error: a workspace with no failed
        // descriptors should report that plainly rather than raise an untracked failure.
        let summary = json!({
            "job_id": job.id(),
            "status": crate::commands::jobs::STATUS_SUCCEEDED,
            "requested_count": 0,
            "processed_count": 0,
            "calculated_count": 0,
            "failed_count": 0,
            "chunk_size": DESCRIPTOR_BATCH_CHUNK_SIZE,
            "aborted": false,
            "errors": Vec::<String>::new(),
            "message_code": "descriptor.batch.nothingToCalculate",
            "mode": "real"
        });
        job.succeed(0, 0, &summary)?;
        return ok("batch_calculate_descriptors", summary);
    }

    let (input_items, mut errors) =
        match load_batch_molecules(&open_connection(app)?, &molecule_ids) {
            Ok(loaded) => loaded,
            Err(err) => {
                // A database failure is recorded against the job before it surfaces, so the history
                // shows the attempt rather than nothing at all.
                job.fail(0, molecule_ids.len() as i64, &err)?;
                return Err(err);
            }
        };
    if input_items.is_empty() {
        // Every requested molecule was unusable. The job records that with its real counts before
        // the error surfaces, so the failure is visible in the history rather than untracked.
        let message = errors.join(" ");
        job.fail(0, molecule_ids.len() as i64, &message)?;
        return Err(message);
    }

    // One sidecar process per chunk, committed as it finishes. A single call covering the whole
    // library would exceed the sidecar timeout and throw away every molecule it had already
    // calculated.
    let mut calculated_count = 0_usize;
    let mut aborted_after: Option<String> = None;
    let mut processed = 0_usize;
    for chunk in input_items.chunks(DESCRIPTOR_BATCH_CHUNK_SIZE) {
        match run_descriptor_chunk(app, chunk, sets.rdkit, sets.mordred).await {
            Ok((chunk_calculated, chunk_errors)) => {
                calculated_count += chunk_calculated;
                errors.extend(chunk_errors);
                processed += chunk.len();
            }
            Err(err) => {
                // The sidecar died or timed out. Stop here rather than waiting out the same
                // timeout for every remaining chunk; work already committed is kept, and the
                // molecules in the abandoned chunk are counted as failures rather than vanishing.
                aborted_after = Some(err);
                break;
            }
        }
        job.progress(
            processed as i64,
            input_items.len() as i64,
            calculated_count as i64,
            errors.len() as i64,
        )?;
    }
    if let Some(err) = &aborted_after {
        errors.push(err.clone());
    }
    // Every requested molecule that did not end up calculated is a failure, whether it was named
    // in an error or simply never reached because the run aborted.
    let failed_count = molecule_ids.len().saturating_sub(calculated_count);

    let mut summary = json!({
        "job_id": job.id(),
        "requested_count": molecule_ids.len(),
        "processed_count": processed,
        "calculated_count": calculated_count,
        "failed_count": failed_count,
        "chunk_size": DESCRIPTOR_BATCH_CHUNK_SIZE,
        "aborted": aborted_after.is_some(),
        "errors": errors,
        "mode": "real"
    });
    // An abort that kept nothing is a failure; one that kept some molecules is partial, because
    // the committed work is real and reporting it as a clean failure would understate it.
    let status = job.finish(
        calculated_count as i64,
        failed_count as i64,
        &summary,
        aborted_after.as_deref(),
    )?;
    summary["status"] = json!(status);
    ok("batch_calculate_descriptors", summary)
}

/// Calculates and commits one chunk. Returns the number of molecules stored plus the per-molecule
/// errors; only a sidecar or database failure aborts the chunk.
async fn run_descriptor_chunk(
    app: &AppHandle,
    items: &[Value],
    require_rdkit: bool,
    require_mordred: bool,
) -> Result<(usize, Vec<String>), String> {
    let result = run_sidecar_command(
        app,
        "calculate-descriptor-batch",
        json!({
            "items": items,
            "require_rdkit": require_rdkit,
            "require_mordred": require_mordred
        }),
    )
    .await?;
    let result_items = result
        .pointer("/data/items")
        .and_then(Value::as_array)
        .ok_or_else(|| "Descriptor batch response did not include an items array.".to_string())?;

    let mut connection = open_connection(app)?;
    let mut tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start descriptor batch transaction: {err}"))?;
    let now = Utc::now().to_rfc3339();
    let mut calculated_count = 0_usize;
    let mut errors = Vec::new();
    for item in result_items {
        let molecule_id = item
            .get("molecule_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let stored = store_molecule_descriptors(
            &mut tx,
            molecule_id,
            item,
            require_rdkit,
            require_mordred,
            &now,
        );
        match stored {
            Ok(()) => calculated_count += 1,
            Err(err) => {
                errors.push(format!("{molecule_id}: {err}"));
                mark_descriptor_failure(&tx, molecule_id, require_rdkit, require_mordred, &now)?;
            }
        }
    }
    tx.commit()
        .map_err(|err| format!("Failed to commit descriptor batch: {err}"))?;
    Ok((calculated_count, errors))
}

/// Stores one molecule's descriptors inside a savepoint so a rejected payload leaves nothing
/// behind for that molecule while the rest of the chunk still commits.
fn store_molecule_descriptors(
    tx: &mut rusqlite::Transaction<'_>,
    molecule_id: &str,
    item: &Value,
    require_rdkit: bool,
    require_mordred: bool,
    now: &str,
) -> Result<(), String> {
    if item.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(item
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Descriptor calculation failed.")
            .to_string());
    }
    let data = item
        .get("data")
        .ok_or_else(|| "the sidecar result did not include data.".to_string())?;

    let mut savepoint = tx
        .savepoint()
        .map_err(|err| format!("Failed to open descriptor savepoint: {err}"))?;
    let written = (|| -> Result<(), String> {
        if require_rdkit {
            persist_descriptor(&savepoint, molecule_id, "rdkit", data.get("rdkit"), now)?;
        }
        if require_mordred {
            persist_descriptor(&savepoint, molecule_id, "mordred", data.get("mordred"), now)?;
        }
        update_molecule_descriptor_status(
            &savepoint,
            molecule_id,
            require_rdkit,
            require_mordred,
            "calculated",
            now,
        )
    })();
    match written {
        Ok(()) => savepoint
            .commit()
            .map_err(|err| format!("Failed to commit descriptor savepoint: {err}")),
        Err(err) => {
            savepoint
                .rollback()
                .map_err(|rollback| format!("{err} (rollback also failed: {rollback})"))?;
            Err(err)
        }
    }
}

/// Reads the SMILES for each requested molecule.
///
/// A molecule that does not exist, or that has no canonical SMILES, is named in the returned
/// errors rather than dropped: a batch of ten ids that quietly calculates eight would report
/// success while losing two.
fn load_batch_molecules(
    connection: &Connection,
    molecule_ids: &[String],
) -> Result<(Vec<Value>, Vec<String>), String> {
    let mut statement = connection
        .prepare("SELECT smiles_canonical FROM molecules WHERE id = ?1")
        .map_err(|err| format!("Failed to prepare descriptor batch query: {err}"))?;
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for molecule_id in molecule_ids {
        let smiles = statement
            .query_row(params![molecule_id], |row| row.get::<_, Option<String>>(0))
            .optional()
            .map_err(|err| format!("Failed to load molecule {molecule_id}: {err}"))?;
        match smiles {
            Some(Some(smiles)) if !smiles.trim().is_empty() => {
                items.push(json!({ "molecule_id": molecule_id, "smiles": smiles }));
            }
            Some(_) => errors.push(format!("{molecule_id}: canonical SMILES is empty.")),
            None => errors.push(format!("{molecule_id}: molecule was not found.")),
        }
    }
    Ok((items, errors))
}

fn persist_descriptor(
    tx: &Connection,
    molecule_id: &str,
    descriptor_set: &str,
    descriptor: Option<&Value>,
    calculated_at: &str,
) -> Result<(), String> {
    let descriptor = descriptor.ok_or_else(|| {
        format!("Sidecar omitted {descriptor_set} descriptors for {molecule_id}.")
    })?;
    let mode = descriptor
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    if mode != "real" {
        return Err(format!(
            "Refusing to persist non-real {descriptor_set} descriptors for {molecule_id}."
        ));
    }
    let descriptors = descriptor
        .get("descriptors")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{descriptor_set} descriptors for {molecule_id} are invalid."))?;
    let descriptors_json = serde_json::to_string(descriptors)
        .map_err(|err| format!("Failed to serialize {descriptor_set} descriptors: {err}"))?;
    tx.execute(
        "DELETE FROM molecule_descriptors WHERE molecule_id = ?1 AND descriptor_set = ?2",
        params![molecule_id, descriptor_set],
    )
    .map_err(|err| format!("Failed to replace {descriptor_set} descriptors: {err}"))?;
    tx.execute(
        "INSERT INTO molecule_descriptors (
            id, molecule_id, descriptor_set, descriptor_version, descriptors_json,
            descriptor_count, status, mode, error_message, calculated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'calculated', 'real', '', ?7)",
        params![
            Uuid::new_v4().to_string(),
            molecule_id,
            descriptor_set,
            descriptor
                .get("descriptor_version")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            descriptors_json,
            descriptor
                .get("descriptor_count")
                .and_then(Value::as_i64)
                .unwrap_or(descriptors.len() as i64),
            calculated_at
        ],
    )
    .map_err(|err| format!("Failed to store {descriptor_set} descriptors: {err}"))?;
    Ok(())
}

fn mark_descriptor_failure(
    tx: &Connection,
    molecule_id: &str,
    rdkit: bool,
    mordred: bool,
    calculated_at: &str,
) -> Result<(), String> {
    update_molecule_descriptor_status(tx, molecule_id, rdkit, mordred, "failed", calculated_at)
}

fn update_molecule_descriptor_status(
    tx: &Connection,
    molecule_id: &str,
    rdkit: bool,
    mordred: bool,
    status: &str,
    updated_at: &str,
) -> Result<(), String> {
    tx.execute(
        "UPDATE molecules SET
            rdkit_descriptor_status = CASE WHEN ?2 THEN ?4 ELSE rdkit_descriptor_status END,
            mordred_descriptor_status = CASE WHEN ?3 THEN ?4 ELSE mordred_descriptor_status END,
            descriptor_ready = CASE
                WHEN (CASE WHEN ?2 THEN ?4 ELSE rdkit_descriptor_status END) = 'calculated'
                 AND (CASE WHEN ?3 THEN ?4 ELSE mordred_descriptor_status END) = 'calculated'
                THEN 1 ELSE 0 END,
            updated_at = ?5
         WHERE id = ?1",
        params![molecule_id, rdkit, mordred, status, updated_at],
    )
    .map_err(|err| format!("Failed to update descriptor status for {molecule_id}: {err}"))?;
    Ok(())
}

#[tauri::command]
pub async fn recalculate_failed_descriptors(app: AppHandle) -> Result<Value, String> {
    recalculate(
        app,
        "WHERE rdkit_descriptor_status = 'failed' OR mordred_descriptor_status = 'failed'",
        "failed",
    )
    .await
}

#[tauri::command]
pub async fn recalculate_all_descriptors(app: AppHandle) -> Result<Value, String> {
    recalculate(app, "", "all").await
}

/// Opens the job, *then* asks the database which molecules to recalculate.
///
/// The order matters: the query is fallible, and a lookup that fails between the user pressing the
/// button and any work starting would otherwise leave no trace at all.
async fn recalculate(app: AppHandle, where_clause: &str, scope: &str) -> Result<Value, String> {
    let sets = validate_descriptor_sets(&[])?;
    let job = crate::commands::jobs::JobGuard::start(
        open_connection(&app)?,
        "descriptor_batch",
        0,
        &json!({ "scope": scope, "descriptorSets": Vec::<String>::new() }),
    )?;
    let molecule_ids = match descriptor_molecule_ids(&app, where_clause) {
        Ok(ids) => ids,
        Err(err) => {
            job.fail(0, 0, &err)?;
            return Err(err);
        }
    };
    run_descriptor_batch(&app, job, molecule_ids, sets).await
}

/// Descriptor batch and recalculation history, read from the jobs table.
#[tauri::command]
pub fn list_descriptor_jobs(app: AppHandle, limit: Option<i64>) -> Result<Value, String> {
    let connection = open_connection(&app)?;
    let items =
        crate::commands::jobs::query_jobs(&connection, &["descriptor_batch"], limit.unwrap_or(25))?;
    ok("list_descriptor_jobs", json!({ "items": items }))
}

fn descriptor_molecule_ids(app: &AppHandle, where_clause: &str) -> Result<Vec<String>, String> {
    let connection = open_connection(app)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT id FROM molecules {where_clause} ORDER BY datetime(created_at), created_at, id"
        ))
        .map_err(|err| format!("Failed to prepare descriptor molecule query: {err}"))?;
    let molecule_ids = statement
        .query_map([], |row| row.get(0))
        .map_err(|err| format!("Failed to query descriptor molecules: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read descriptor molecule: {err}"))?;
    Ok(molecule_ids)
}

#[tauri::command]
/// Descriptor records for one molecule, for a named set of molecules, or for the whole workspace.
///
/// `molecule_ids` exists because the descriptor centre shows one page of molecules with the status
/// of each. Asking per molecule meant one IPC round trip per row — twenty-five calls to render one
/// page — and asking for all of them meant reading every descriptor record in the workspace to
/// display twenty-five. Naming the page's ids asks exactly the question the screen has.
pub fn list_molecule_descriptors(
    app: AppHandle,
    molecule_id: Option<String>,
    molecule_ids: Option<Vec<String>>,
    include_values: Option<bool>,
) -> Result<Vec<MoleculeDescriptorDto>, String> {
    let conn = open_connection(&app)?;
    // A Mordred record holds ~1,800 values. Status views ask for many molecules at once and read
    // none of them, so the blob is only selected when the caller actually wants it.
    let values_column = if include_values.unwrap_or(false) {
        "descriptors_json"
    } else {
        "'{}'"
    };
    // A named set of molecules: one statement with one placeholder per id.
    if let Some(ids) = molecule_ids.filter(|ids| !ids.is_empty()) {
        let placeholders = (1..=ids.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, molecule_id, descriptor_set, descriptor_version, {values_column},
                    descriptor_count, status, mode, error_message, calculated_at
             FROM molecule_descriptors
             WHERE molecule_id IN ({placeholders})
             ORDER BY molecule_id, descriptor_set"
        );
        let mut statement = conn
            .prepare(&sql)
            .map_err(|err| format!("Failed to prepare descriptor query: {err}"))?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(ids.iter()), descriptor_from_row)
            .map_err(|err| format!("Failed to query descriptors: {err}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("Failed to read descriptor row: {err}"))?;
        return Ok(rows);
    }

    let (sql, params_vec): (String, Vec<String>) = if let Some(id) = molecule_id {
        (
            format!(
                "SELECT id, molecule_id, descriptor_set, descriptor_version, {values_column},
                        descriptor_count, status, mode, error_message, calculated_at
                 FROM molecule_descriptors
                 WHERE molecule_id = ?1
                 ORDER BY descriptor_set"
            ),
            vec![id],
        )
    } else {
        (
            format!(
                "SELECT id, molecule_id, descriptor_set, descriptor_version, {values_column},
                        descriptor_count, status, mode, error_message, calculated_at
                 FROM molecule_descriptors
                 ORDER BY calculated_at DESC, id DESC"
            ),
            vec![],
        )
    };
    let mut statement = conn
        .prepare(&sql)
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

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
        connection
            .execute_batch(
                "CREATE TABLE molecule_descriptors (
                    id TEXT PRIMARY KEY,
                    molecule_id TEXT NOT NULL,
                    descriptor_set TEXT NOT NULL,
                    descriptor_version TEXT,
                    descriptors_json TEXT NOT NULL,
                    descriptor_count INTEGER,
                    status TEXT NOT NULL,
                    mode TEXT,
                    error_message TEXT,
                    calculated_at TEXT
                );",
            )
            .expect("descriptor table should initialize");
        connection
    }

    #[test]
    fn descriptor_persistence_rejects_mock_payloads() {
        let mut connection = descriptor_connection();
        let tx = connection.transaction().expect("transaction should start");
        let result = persist_descriptor(
            &tx,
            "mol-1",
            "rdkit",
            Some(&json!({
                "mode": "mock",
                "descriptor_count": 1,
                "descriptors": { "MolWt": 46.0 }
            })),
            "2026-01-01",
        );

        assert!(result
            .expect_err("mock data must be rejected")
            .contains("non-real"));
    }

    #[test]
    fn descriptor_persistence_stores_real_payloads() {
        let mut connection = descriptor_connection();
        let tx = connection.transaction().expect("transaction should start");
        persist_descriptor(
            &tx,
            "mol-1",
            "rdkit",
            Some(&json!({
                "mode": "real",
                "descriptor_version": "test",
                "descriptor_count": 1,
                "descriptors": { "MolWt": 46.0 }
            })),
            "2026-01-01",
        )
        .expect("real data should persist");
        tx.commit().expect("transaction should commit");

        let stored: (String, String, i64) = connection
            .query_row(
                "SELECT mode, status, descriptor_count FROM molecule_descriptors",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("stored descriptor should be readable");
        assert_eq!(stored, ("real".to_string(), "calculated".to_string(), 1));
    }

    fn descriptor_batch_connection() -> Connection {
        let connection = descriptor_connection();
        connection
            .execute_batch(
                "CREATE TABLE molecules (
                    id TEXT PRIMARY KEY,
                    rdkit_descriptor_status TEXT,
                    mordred_descriptor_status TEXT,
                    descriptor_ready INTEGER DEFAULT 0,
                    updated_at TEXT
                );
                INSERT INTO molecules (id) VALUES ('good'), ('bad');",
            )
            .expect("molecules table should initialize");
        connection
    }

    fn batch_item(molecule_id: &str, mode: &str) -> Value {
        json!({
            "molecule_id": molecule_id,
            "ok": true,
            "data": {
                "rdkit": {
                    "mode": "real",
                    "descriptor_version": "test",
                    "descriptor_count": 1,
                    "descriptors": { "MolWt": 46.0 }
                },
                "mordred": {
                    "mode": mode,
                    "descriptor_version": "test",
                    "descriptor_count": 1,
                    "descriptors": { "ABC": 1.0 }
                }
            }
        })
    }

    #[test]
    fn a_rejected_molecule_does_not_discard_the_rest_of_the_chunk() {
        let mut connection = descriptor_batch_connection();
        let mut tx = connection.transaction().expect("transaction should start");

        store_molecule_descriptors(
            &mut tx,
            "good",
            &batch_item("good", "real"),
            true,
            true,
            "2026-01-01",
        )
        .expect("a fully real payload should store");
        let rejected = store_molecule_descriptors(
            &mut tx,
            "bad",
            &batch_item("bad", "mock"),
            true,
            true,
            "2026-01-01",
        )
        .expect_err("a mock payload must be rejected");
        mark_descriptor_failure(&tx, "bad", true, true, "2026-01-01")
            .expect("the failure should be recorded");
        tx.commit().expect("transaction should commit");

        assert!(rejected.contains("non-real"));
        let stored_ids: Vec<String> = connection
            .prepare("SELECT DISTINCT molecule_id FROM molecule_descriptors ORDER BY molecule_id")
            .expect("query should prepare")
            .query_map([], |row| row.get(0))
            .expect("query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows should read");
        // The rejected molecule rolled back completely, including the rdkit half that had
        // already been written before mordred was refused.
        assert_eq!(stored_ids, vec!["good".to_string()]);

        let bad_status: String = connection
            .query_row(
                "SELECT mordred_descriptor_status FROM molecules WHERE id = 'bad'",
                [],
                |row| row.get(0),
            )
            .expect("status should be readable");
        assert_eq!(bad_status, "failed");
    }

    /// A batch request must not quietly shrink: an id that does not resolve is reported by name.
    #[test]
    fn a_batch_names_the_molecules_it_could_not_load() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
        connection
            .execute_batch(crate::db::schema::INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute_batch(
                "INSERT INTO molecules (id, name, smiles_canonical, created_at, updated_at) VALUES
                   ('mol-ok', 'Ethanol', 'CCO', '2026-01-01', '2026-01-01'),
                   ('mol-blank', 'Unknown', '', '2026-01-01', '2026-01-01'),
                   ('mol-null', 'Unresolved', NULL, '2026-01-01', '2026-01-01');",
            )
            .expect("fixtures should insert");

        let (items, errors) = load_batch_molecules(
            &connection,
            &[
                "mol-ok".to_string(),
                "mol-blank".to_string(),
                "mol-null".to_string(),
                "mol-missing".to_string(),
            ],
        )
        .expect("the query should run");

        assert_eq!(items.len(), 1, "only the usable molecule is calculated");
        assert_eq!(items[0]["molecule_id"], "mol-ok");
        assert_eq!(errors.len(), 3);
        assert!(errors
            .iter()
            .any(|text| text.contains("mol-missing") && text.contains("was not found")));
        assert!(errors
            .iter()
            .any(|text| text.contains("mol-blank") && text.contains("SMILES is empty")));
        assert!(errors.iter().any(|text| text.contains("mol-null")));
    }

    #[test]
    fn an_empty_batch_request_loads_nothing_and_reports_nothing() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
        connection
            .execute_batch(crate::db::schema::INIT_SCHEMA_SQL)
            .expect("schema should initialize");

        let (items, errors) = load_batch_molecules(&connection, &[]).expect("the query should run");

        assert!(items.is_empty());
        assert!(errors.is_empty(), "no work is not a failure");
    }
}
