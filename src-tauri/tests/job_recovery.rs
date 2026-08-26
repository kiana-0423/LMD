//! Job records across process boundaries, against a real database file.
//!
//! A job row outlives the process that created it. These check the two things that can go wrong
//! because of that: a row left claiming to be running after a crash, and a batch that failed being
//! remembered as a success.

use lubricant_materials_database::commands::jobs::{
    mark_interrupted_jobs, query_jobs, JobGuard, STATUS_FAILED, STATUS_INTERRUPTED, STATUS_PARTIAL,
    STATUS_RUNNING, STATUS_SUCCEEDED,
};
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "lmd-jobs-int-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace should be created");
        let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
        connection
            .execute_batch(schema())
            .expect("schema should initialize");
        Self { root }
    }

    /// A brand new connection, as a restarted application would open.
    fn open(&self) -> Connection {
        Connection::open(self.root.join("lmd.sqlite")).expect("database should open")
    }

    fn status(&self, id: &str) -> (String, i64, i64, String) {
        self.open()
            .query_row(
                "SELECT status, success_count, failed_count, COALESCE(error_message, '')
                 FROM jobs WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("job row should exist")
    }

    fn cleanup(&self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn a_job_left_running_by_a_crashed_process_is_closed_when_the_application_restarts() {
    let workspace = Workspace::new("restart");
    let id = {
        let job = JobGuard::start(
            workspace.open(),
            "descriptor_batch",
            5,
            &json!({ "ids": 5 }),
        )
        .expect("job should start");
        let id = job.id().to_string();
        job.progress(2, 5, 2, 0).expect("progress should record");
        // `forget` reproduces a kill -9: the guard never runs, and the row is left as it was.
        std::mem::forget(job);
        id
    };
    assert_eq!(
        workspace.status(&id).0,
        STATUS_RUNNING,
        "as a crash leaves it"
    );

    // The next launch, on a fresh connection to the same file.
    let restarted = workspace.open();
    let closed = mark_interrupted_jobs(&restarted).expect("startup sweep should run");

    assert_eq!(closed, 1);
    let (status, success, _, error) = workspace.status(&id);
    assert_eq!(status, STATUS_INTERRUPTED);
    assert_eq!(success, 2, "work that really happened is still recorded");
    assert!(
        error.contains("still running when the application last closed"),
        "{error}"
    );
    workspace.cleanup();
}

#[test]
fn a_second_restart_finds_nothing_left_to_close() {
    let workspace = Workspace::new("idempotent");
    {
        let job = JobGuard::start(workspace.open(), "train_model", 1, &json!({}))
            .expect("job should start");
        std::mem::forget(job);
    }
    let connection = workspace.open();

    assert_eq!(mark_interrupted_jobs(&connection).expect("first sweep"), 1);
    assert_eq!(
        mark_interrupted_jobs(&connection).expect("second sweep"),
        0,
        "a restart must not keep rewriting closed rows"
    );
    workspace.cleanup();
}

#[test]
fn a_finished_job_is_never_touched_by_the_restart_sweep() {
    let workspace = Workspace::new("finished");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 2, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();
    job.finish(2, 0, &json!({ "calculated": 2 }), None)
        .expect("job should close");

    let connection = workspace.open();
    assert_eq!(mark_interrupted_jobs(&connection).expect("sweep"), 0);
    assert_eq!(workspace.status(&id).0, STATUS_SUCCEEDED);
    workspace.cleanup();
}

#[test]
fn a_batch_that_partly_failed_is_recorded_as_partial_and_keeps_both_counts() {
    let workspace = Workspace::new("partial");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 10, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();

    job.finish(7, 3, &json!({ "calculated": 7 }), None)
        .expect("job should close");

    let (status, success, failed, error) = workspace.status(&id);
    assert_eq!(status, STATUS_PARTIAL);
    assert_eq!((success, failed), (7, 3));
    assert!(error.contains("3 of 10"), "{error}");
    workspace.cleanup();
}

#[test]
fn a_batch_where_every_item_failed_is_recorded_as_failed() {
    let workspace = Workspace::new("allfailed");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 4, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();

    job.finish(0, 4, &json!({}), None)
        .expect("job should close");

    assert_eq!(workspace.status(&id).0, STATUS_FAILED);
    workspace.cleanup();
}

#[test]
fn a_batch_with_no_work_to_do_is_recorded_as_a_success() {
    // Recalculating when nothing has failed is a legitimate zero-work outcome, not an error.
    let workspace = Workspace::new("nowork");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 0, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();

    job.finish(0, 0, &json!({ "message": "nothing to calculate" }), None)
        .expect("job should close");

    let (status, success, failed, error) = workspace.status(&id);
    assert_eq!(status, STATUS_SUCCEEDED);
    assert_eq!((success, failed), (0, 0));
    assert!(error.is_empty());
    workspace.cleanup();
}

#[test]
fn a_sidecar_timeout_is_recorded_against_the_job_with_the_work_already_done() {
    let workspace = Workspace::new("timeout");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 200, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();
    job.progress(50, 200, 50, 0)
        .expect("progress should record");

    job.fail(50, 150, "The packaged sidecar timed out after 300 seconds.")
        .expect("job should close");

    let (status, success, failed, error) = workspace.status(&id);
    assert_eq!(status, STATUS_FAILED);
    assert_eq!(
        (success, failed),
        (50, 150),
        "committed work survives the abort"
    );
    assert!(error.contains("timed out"), "{error}");
    workspace.cleanup();
}

#[test]
fn job_history_reads_back_after_a_restart_in_a_deterministic_order() {
    let workspace = Workspace::new("history");
    for index in 0..3 {
        let job = JobGuard::start(
            workspace.open(),
            "descriptor_batch",
            1,
            &json!({ "i": index }),
        )
        .expect("job should start");
        job.finish(1, 0, &json!({}), None)
            .expect("job should close");
    }
    let job =
        JobGuard::start(workspace.open(), "train_model", 1, &json!({})).expect("job should start");
    job.finish(1, 0, &json!({}), None)
        .expect("job should close");

    let reader = workspace.open();
    let descriptors = query_jobs(&reader, &["descriptor_batch"], 10).expect("query should run");
    let again = query_jobs(&reader, &["descriptor_batch"], 10).expect("query should run");

    assert_eq!(descriptors.len(), 3, "the train_model row is filtered out");
    assert_eq!(descriptors, again, "repeated reads agree");
    assert_eq!(query_jobs(&reader, &[], 10).expect("all").len(), 4);
    workspace.cleanup();
}

// --- the failed / partial distinction ------------------------------------------------------------

#[test]
fn a_sidecar_abort_that_kept_nothing_is_failed() {
    let workspace = Workspace::new("abort-nothing");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 20, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();

    // The first chunk never completed, so nothing was committed.
    let status = job
        .finish(
            0,
            20,
            &json!({ "aborted": true }),
            Some("The packaged sidecar timed out after 300 seconds."),
        )
        .expect("job should close");

    assert_eq!(status, STATUS_FAILED);
    let (stored, success, failed, error) = workspace.status(&id);
    assert_eq!(stored, STATUS_FAILED);
    assert_eq!((success, failed), (0, 20));
    assert!(error.contains("timed out"), "{error}");
}

#[test]
fn a_sidecar_abort_after_some_completed_items_is_partial_not_failed() {
    let workspace = Workspace::new("abort-partial");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 20, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();
    // Two chunks of four committed before the third timed out.
    job.progress(8, 20, 8, 0).expect("progress should record");

    let status = job
        .finish(
            8,
            12,
            &json!({ "aborted": true, "calculated_count": 8 }),
            Some("The packaged sidecar timed out after 300 seconds."),
        )
        .expect("job should close");

    // Eight molecules really do have descriptors now. Recording that as a clean failure would
    // understate what happened and invite the user to redo work that is already done.
    assert_eq!(status, STATUS_PARTIAL);
    let (stored, success, failed, error) = workspace.status(&id);
    assert_eq!(stored, STATUS_PARTIAL);
    assert_eq!((success, failed), (8, 12));
    assert!(error.contains("12 of 20"), "{error}");
    assert!(error.contains("timed out"), "the cause survives: {error}");
}

#[test]
fn a_batch_that_completes_with_no_failures_carries_no_error_text() {
    let workspace = Workspace::new("clean");
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 3, &json!({}))
        .expect("job should start");
    let id = job.id().to_string();

    let status = job
        .finish(3, 0, &json!({}), None)
        .expect("job should close");

    assert_eq!(status, STATUS_SUCCEEDED);
    assert!(workspace.status(&id).3.is_empty());
}

#[test]
fn every_terminal_path_leaves_a_status_that_is_not_running() {
    // The property that matters across all of them: whichever way a job ends, it ends.
    let workspace = Workspace::new("terminal");
    let mut ids = Vec::new();

    let job = JobGuard::start(workspace.open(), "descriptor_batch", 1, &json!({}))
        .expect("job should start");
    ids.push(job.id().to_string());
    job.succeed(1, 0, &json!({})).expect("closes");

    let job = JobGuard::start(workspace.open(), "descriptor_batch", 1, &json!({}))
        .expect("job should start");
    ids.push(job.id().to_string());
    job.fail(0, 1, "a database lookup failed").expect("closes");

    let job = JobGuard::start(workspace.open(), "descriptor_batch", 2, &json!({}))
        .expect("job should start");
    ids.push(job.id().to_string());
    job.finish(1, 1, &json!({}), None).expect("closes");

    // Dropped without an outcome, which is what a panic or a cancelled future produces.
    let job = JobGuard::start(workspace.open(), "descriptor_batch", 1, &json!({}))
        .expect("job should start");
    ids.push(job.id().to_string());
    drop(job);

    for id in &ids {
        let status = workspace.status(id).0;
        assert_ne!(status, STATUS_RUNNING, "job {id} was left running");
    }
    workspace.cleanup();
}
