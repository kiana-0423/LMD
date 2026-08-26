//! Job records for long-running work.
//!
//! A job row is written as soon as a request is known to be well-formed — before any database
//! read, filesystem work, or sidecar call — and closed on every exit path, including early errors.
//! A job left permanently in `running` would misreport the workspace, so the guard below marks any
//! job that is dropped without an explicit outcome as `failed`, and startup closes any row left
//! `running` by a process that is no longer alive.
//!
//! A batch that finished with failures is not a success. Three closing states exist:
//!
//!  * `succeeded` — every unit of work succeeded (including a batch with no work to do),
//!  * `partial`   — some units succeeded and some failed,
//!  * `failed`    — nothing succeeded, or the operation aborted.

use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use uuid::Uuid;

/// Status values a job row can hold.
pub const STATUS_RUNNING: &str = "running";
pub const STATUS_SUCCEEDED: &str = "succeeded";
pub const STATUS_PARTIAL: &str = "partial";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_INTERRUPTED: &str = "interrupted";

/// Chooses the closing status from what actually happened.
///
/// A batch where everything failed must never be recorded as a success, and a batch with no work
/// to do is a legitimate success rather than an error.
pub fn outcome_status(success: i64, failed: i64) -> &'static str {
    match (success, failed) {
        (_, 0) => STATUS_SUCCEEDED,
        (0, _) => STATUS_FAILED,
        _ => STATUS_PARTIAL,
    }
}

/// An open job. Finishing it explicitly records the outcome; dropping it without finishing marks
/// the row failed, so an early `?` return can never leave a job stuck at `running`.
pub struct JobGuard {
    connection: Connection,
    id: String,
    job_type: String,
    finished: bool,
}

impl JobGuard {
    /// Takes ownership of a connection so the guard stays `Send` and can be held across an
    /// `await` inside an async Tauri command.
    pub fn start(
        connection: Connection,
        job_type: &str,
        total_count: i64,
        input: &Value,
    ) -> Result<Self, String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        connection
            .execute(
                "INSERT INTO jobs (
                    id, job_type, status, progress, total_count, success_count, failed_count,
                    input_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 0.0, ?4, 0, 0, ?5, ?6, ?6)",
                params![
                    &id,
                    job_type,
                    STATUS_RUNNING,
                    total_count,
                    input.to_string(),
                    &now
                ],
            )
            .map_err(|err| format!("Failed to record the {job_type} job: {err}"))?;
        Ok(Self {
            connection,
            id,
            job_type: job_type.to_string(),
            finished: false,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Records how much work the job turned out to involve.
    ///
    /// A job is opened before the work is measured — the request is validated, then everything
    /// after it is tracked — so the total is filled in once the dataset or batch is known.
    pub fn set_total(&self, total: i64) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE jobs SET total_count = ?2, updated_at = ?3 WHERE id = ?1",
                params![&self.id, total, Utc::now().to_rfc3339()],
            )
            .map_err(|err| format!("Failed to size the {} job: {err}", self.job_type))?;
        Ok(())
    }

    /// Records intermediate progress so a long batch is observable while it runs.
    pub fn progress(&self, done: i64, total: i64, success: i64, failed: i64) -> Result<(), String> {
        let fraction = if total > 0 {
            (done as f64 / total as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        self.connection
            .execute(
                "UPDATE jobs SET progress = ?2, success_count = ?3, failed_count = ?4,
                                updated_at = ?5
                 WHERE id = ?1",
                params![&self.id, fraction, success, failed, Utc::now().to_rfc3339()],
            )
            .map_err(|err| format!("Failed to update the {} job: {err}", self.job_type))?;
        Ok(())
    }

    /// Closes the job with the status its counts imply.
    ///
    /// Passing a non-zero failure count records `partial`, or `failed` when nothing succeeded, so
    /// a batch that only failed can never be listed as a success. `detail` replaces the generated
    /// count summary when the caller knows something more useful — a sidecar that timed out, say,
    /// after part of the batch had already been committed.
    pub fn finish(
        mut self,
        success: i64,
        failed: i64,
        output: &Value,
        detail: Option<&str>,
    ) -> Result<&'static str, String> {
        let status = outcome_status(success, failed);
        let summary = format!("{failed} of {} item(s) failed.", success + failed);
        let error = match (status, detail) {
            (STATUS_SUCCEEDED, None) => String::new(),
            (STATUS_SUCCEEDED, Some(detail)) => detail.to_string(),
            (_, Some(detail)) => format!("{summary} {detail}"),
            (_, None) => summary,
        };
        self.close(status, success, failed, output, &error)?;
        self.finished = true;
        Ok(status)
    }

    /// Closes a job that succeeded outright. Prefer [`JobGuard::finish`] for anything batched.
    pub fn succeed(mut self, success: i64, failed: i64, output: &Value) -> Result<(), String> {
        self.close(outcome_status(success, failed), success, failed, output, "")?;
        self.finished = true;
        Ok(())
    }

    /// Closes a job as failed, preserving whatever counts the work had reached.
    pub fn fail(mut self, success: i64, failed: i64, error: &str) -> Result<(), String> {
        self.close(STATUS_FAILED, success, failed, &json!({}), error)?;
        self.finished = true;
        Ok(())
    }

    fn close(
        &self,
        status: &str,
        success: i64,
        failed: i64,
        output: &Value,
        error: &str,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE jobs SET status = ?2, progress = 1.0, success_count = ?3,
                                failed_count = ?4, output_json = ?5, error_message = ?6,
                                updated_at = ?7
                 WHERE id = ?1",
                params![
                    &self.id,
                    status,
                    success,
                    failed,
                    output.to_string(),
                    error,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(|err| format!("Failed to close the {} job: {err}", self.job_type))?;
        Ok(())
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        // An early return or a panic must not leave the row claiming the work is still running.
        // The counts already recorded by `progress` are kept: work that really was done should not
        // be erased by the way the operation ended.
        if let Err(err) = self.connection.execute(
            "UPDATE jobs SET status = ?2, progress = 1.0, error_message = ?3, updated_at = ?4
             WHERE id = ?1",
            params![
                &self.id,
                STATUS_FAILED,
                "The operation ended before it reported an outcome.",
                Utc::now().to_rfc3339()
            ],
        ) {
            eprintln!(
                "LMD: the {} job {} could not be closed on drop: {err}",
                self.job_type, self.id
            );
        }
    }
}

/// Closes every job still marked `running` when the application starts.
///
/// Such a row cannot belong to this process, so it was interrupted — by a crash, a kill, or a
/// power loss. Returns how many rows were closed.
pub fn mark_interrupted_jobs_on_startup(app: &tauri::AppHandle) -> Result<usize, String> {
    let connection = crate::db::open_database(crate::app_paths::default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database to close old jobs: {err}"))?;
    mark_interrupted_jobs(&connection)
}

/// The database half of [`mark_interrupted_jobs_on_startup`], separated so it can be tested.
pub fn mark_interrupted_jobs(connection: &Connection) -> Result<usize, String> {
    connection
        .execute(
            "UPDATE jobs
             SET status = ?1,
                 error_message = 'This job was still running when the application last closed, so it did not finish.',
                 updated_at = ?2
             WHERE status = ?3",
            params![STATUS_INTERRUPTED, Utc::now().to_rfc3339(), STATUS_RUNNING],
        )
        .map_err(|err| format!("Failed to close interrupted jobs: {err}"))
}

/// Reads job history with deterministic ordering and a bounded limit.
pub fn query_jobs(
    connection: &Connection,
    job_types: &[&str],
    limit: i64,
) -> Result<Vec<Value>, String> {
    let limit = limit.clamp(1, 500);
    let filter = if job_types.is_empty() {
        String::new()
    } else {
        let list = job_types
            .iter()
            .map(|value| format!("'{value}'"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("WHERE job_type IN ({list})")
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT id, job_type, status, progress, total_count, success_count, failed_count,
                    input_json, output_json, error_message, created_at, updated_at
             FROM jobs
             {filter}
             ORDER BY datetime(created_at) DESC, created_at DESC, id DESC
             LIMIT ?1"
        ))
        .map_err(|err| format!("Failed to prepare the job query: {err}"))?;
    let rows = statement
        .query_map(params![limit], |row| {
            let parse = |text: Option<String>| {
                serde_json::from_str::<Value>(&text.unwrap_or_default())
                    .unwrap_or_else(|_| json!({}))
            };
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "jobType": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "progress": row.get::<_, Option<f64>>(3)?.unwrap_or_default(),
                "totalCount": row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                "successCount": row.get::<_, Option<i64>>(5)?.unwrap_or_default(),
                "failedCount": row.get::<_, Option<i64>>(6)?.unwrap_or_default(),
                "input": parse(row.get::<_, Option<String>>(7)?),
                "output": parse(row.get::<_, Option<String>>(8)?),
                "errorMessage": row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                "createdAt": row.get::<_, String>(10)?,
                "updatedAt": row.get::<_, String>(11)?
            }))
        })
        .map_err(|err| format!("Failed to query jobs: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a job row: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;
    use std::path::PathBuf;

    /// A file-backed database so the guard can own one connection while the test reads through
    /// another, which is exactly how the commands use it.
    fn workspace(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lmd-jobs-{name}-{}-{}.sqlite",
            std::process::id(),
            name.len()
        ));
        let _ = std::fs::remove_file(&path);
        let connection = Connection::open(&path).expect("database should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        path
    }

    fn open(path: &PathBuf) -> Connection {
        Connection::open(path).expect("database should open")
    }

    fn status_of(path: &PathBuf, id: &str) -> (String, f64, i64, i64, String) {
        open(path)
            .query_row(
                "SELECT status, progress, success_count, failed_count, error_message
                 FROM jobs WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get::<_, Option<f64>>(1)?.unwrap_or_default(),
                        row.get(2)?,
                        row.get(3)?,
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    ))
                },
            )
            .expect("job row should exist")
    }

    #[test]
    fn a_successful_job_is_recorded_with_its_counts() {
        let path = workspace("success");
        let job = JobGuard::start(open(&path), "descriptor_batch", 10, &json!({ "ids": 10 }))
            .expect("job should start");
        let id = job.id().to_string();
        assert_eq!(status_of(&path, &id).0, STATUS_RUNNING);

        job.progress(5, 10, 4, 1).expect("progress should record");
        assert!((status_of(&path, &id).1 - 0.5).abs() < 1e-9);

        job.succeed(10, 0, &json!({ "calculated": 10 }))
            .expect("job should close");

        let (status, progress, success, failed, error) = status_of(&path, &id);
        assert_eq!(status, STATUS_SUCCEEDED);
        assert!((progress - 1.0).abs() < 1e-9);
        assert_eq!((success, failed), (10, 0));
        assert!(error.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_batch_with_some_failures_is_recorded_as_partial_not_succeeded() {
        let path = workspace("partial");
        let job = JobGuard::start(open(&path), "descriptor_batch", 10, &json!({}))
            .expect("job should start");
        let id = job.id().to_string();

        let status = job
            .finish(9, 1, &json!({ "calculated": 9 }), None)
            .expect("job should close");

        assert_eq!(status, STATUS_PARTIAL);
        let (stored, _, success, failed, error) = status_of(&path, &id);
        assert_eq!(stored, STATUS_PARTIAL);
        assert_eq!((success, failed), (9, 1));
        assert!(error.contains("1 of 10"), "{error}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_batch_where_everything_failed_is_never_recorded_as_a_success() {
        let path = workspace("allfailed");
        let job = JobGuard::start(open(&path), "descriptor_batch", 4, &json!({}))
            .expect("job should start");
        let id = job.id().to_string();

        let status = job
            .finish(0, 4, &json!({}), None)
            .expect("job should close");

        assert_eq!(status, STATUS_FAILED);
        assert_eq!(status_of(&path, &id).0, STATUS_FAILED);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_batch_with_no_work_to_do_is_a_success() {
        // Recalculating when nothing has failed is a legitimate zero-work outcome.
        let path = workspace("nowork");
        let job = JobGuard::start(open(&path), "descriptor_batch", 0, &json!({}))
            .expect("job should start");
        let id = job.id().to_string();

        let status = job
            .finish(0, 0, &json!({}), None)
            .expect("job should close");

        assert_eq!(status, STATUS_SUCCEEDED);
        assert_eq!(status_of(&path, &id).0, STATUS_SUCCEEDED);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_dropped_job_keeps_the_counts_its_progress_had_reported() {
        let path = workspace("keepcounts");
        let id = {
            let job = JobGuard::start(open(&path), "descriptor_batch", 10, &json!({}))
                .expect("job should start");
            let id = job.id().to_string();
            job.progress(6, 10, 5, 1).expect("progress should record");
            // A panic or an early `?` between the last progress report and the outcome.
            drop(job);
            id
        };

        let (status, _, success, failed, error) = status_of(&path, &id);
        assert_eq!(status, STATUS_FAILED);
        assert_eq!(
            (success, failed),
            (5, 1),
            "work that really happened must not be erased"
        );
        assert!(error.contains("ended before it reported an outcome"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_job_left_running_by_a_previous_process_is_closed_at_startup() {
        let path = workspace("restart");
        let id = {
            let job = JobGuard::start(open(&path), "descriptor_batch", 3, &json!({}))
                .expect("job should start");
            let id = job.id().to_string();
            // `std::mem::forget` reproduces what a kill -9 does: the guard never runs.
            std::mem::forget(job);
            id
        };
        assert_eq!(status_of(&path, &id).0, STATUS_RUNNING);

        let reader = open(&path);
        let closed = mark_interrupted_jobs(&reader).expect("startup sweep should run");

        assert_eq!(closed, 1);
        let (status, _, _, _, error) = status_of(&path, &id);
        assert_eq!(status, STATUS_INTERRUPTED);
        assert!(error.contains("still running when the application last closed"));

        // Running the sweep again changes nothing, so a restart is idempotent.
        assert_eq!(mark_interrupted_jobs(&reader).expect("second sweep"), 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_failed_job_records_an_actionable_message() {
        let path = workspace("failure");
        let job = JobGuard::start(open(&path), "descriptor_batch", 3, &json!({}))
            .expect("job should start");
        let id = job.id().to_string();

        job.fail(1, 2, "The packaged sidecar timed out after 300 seconds.")
            .expect("job should close");

        let (status, _, success, failed, error) = status_of(&path, &id);
        assert_eq!(status, STATUS_FAILED);
        assert_eq!((success, failed), (1, 2));
        assert!(error.contains("timed out"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_job_dropped_without_an_outcome_is_marked_failed_not_left_running() {
        let path = workspace("interrupted");
        let id = {
            let job = JobGuard::start(open(&path), "descriptor_batch", 5, &json!({}))
                .expect("job should start");
            let id = job.id().to_string();
            // Simulates an early `?` return between starting the job and reporting an outcome.
            drop(job);
            id
        };

        let (status, _, _, _, error) = status_of(&path, &id);
        assert_eq!(status, STATUS_FAILED, "no job may stay at running");
        assert!(error.contains("ended before it reported an outcome"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn job_history_is_ordered_and_bounded() {
        let path = workspace("history");
        for index in 0..5 {
            let job = JobGuard::start(open(&path), "descriptor_batch", 1, &json!({ "i": index }))
                .expect("job should start");
            job.succeed(1, 0, &json!({})).expect("job should close");
        }
        let job =
            JobGuard::start(open(&path), "train_model", 1, &json!({})).expect("job should start");
        job.succeed(1, 0, &json!({})).expect("job should close");

        let reader = open(&path);
        let all = query_jobs(&reader, &[], 100).expect("query should run");
        assert_eq!(all.len(), 6);

        let descriptors = query_jobs(&reader, &["descriptor_batch"], 3).expect("query");
        assert_eq!(descriptors.len(), 3, "the limit is honoured");
        assert!(descriptors
            .iter()
            .all(|item| item["jobType"] == "descriptor_batch"));

        // Deterministic ordering: repeated calls agree.
        let again = query_jobs(&reader, &["descriptor_batch"], 3).expect("query");
        assert_eq!(descriptors, again);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_unparseable_payload_does_not_break_the_listing() {
        let path = workspace("payload");
        let connection = open(&path);
        connection
            .execute(
                "INSERT INTO jobs (id, job_type, status, input_json, output_json, created_at, updated_at)
                 VALUES ('j-1', 'descriptor_batch', 'succeeded', 'not json', 'also not json',
                         '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("row should insert");

        let items = query_jobs(&connection, &[], 10).expect("query should run");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["input"], json!({}));
        let _ = std::fs::remove_file(&path);
    }
}
