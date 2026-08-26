//! Proof that saving a test run and its measurements is all-or-nothing.
//!
//! The frontend used to call `create_experiment` and then `create_performance_result`. When the
//! second call failed — a disk error, a constraint, a process that went away — the first had
//! already committed, and the workspace kept an experiment with no measurements. That row is
//! indistinguishable from a test whose results are genuinely still being entered, so nobody could
//! tell the difference later.
//!
//! Asserting the rollback needs the second insert to actually fail, so these tests install a
//! trigger that aborts it. The failure is artificial; the rollback it exercises is not.

use lubricant_materials_database::commands::experiment::{
    write_experiment_with_performance, ExperimentWithPerformanceRequest, ValidatedExperimentWrite,
};
use rusqlite::Connection;
use serde_json::json;

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

fn workspace_with_one_formulation() -> Connection {
    let connection = Connection::open_in_memory().expect("sqlite should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled");
    connection
        .execute_batch(schema())
        .expect("schema should initialize");
    connection
        .execute_batch(
            "INSERT INTO formulations (id, name, created_at, updated_at)
             VALUES ('f-1', 'PAO 6 + ZDDP 1%', '2026-01-01', '2026-01-01');",
        )
        .expect("formulation should insert");
    connection
}

fn valid_request() -> ValidatedExperimentWrite {
    serde_json::from_value::<ExperimentWithPerformanceRequest>(json!({
        "formulationId": "f-1",
        "testType": "SRV",
        "loadValue": 100,
        "loadUnit": "N",
        "averageFrictionCoefficient": 0.081,
        "wearScarDiameterValue": 420,
        "repeatCount": 3
    }))
    .expect("the fixture is well-formed")
    .validate()
    .expect("the fixture is valid")
}

#[test]
fn a_failing_performance_insert_leaves_no_orphan_experiment() {
    let mut connection = workspace_with_one_formulation();
    // Anything that makes the *second* statement fail will do; a trigger is the one mechanism that
    // does not also make the first one fail.
    connection
        .execute_batch(
            "CREATE TRIGGER refuse_results BEFORE INSERT ON performance_results
             BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
        )
        .expect("trigger should be created");

    let error = write_experiment_with_performance(&mut connection, &valid_request(), "2026-02-01")
        .expect_err("the second insert fails, so the whole save must fail");
    assert!(
        error.contains("simulated storage failure"),
        "the real cause has to survive into the message: {error}"
    );

    let experiments: i64 = connection
        .query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0))
        .expect("the count should read");
    assert_eq!(
        experiments, 0,
        "an experiment whose results could not be stored must not remain"
    );

    let results: i64 = connection
        .query_row("SELECT COUNT(*) FROM performance_results", [], |row| {
            row.get(0)
        })
        .expect("the count should read");
    assert_eq!(results, 0);
}

#[test]
fn a_successful_save_writes_exactly_one_experiment_and_one_result() {
    let mut connection = workspace_with_one_formulation();

    let (experiment_id, result_id) =
        write_experiment_with_performance(&mut connection, &valid_request(), "2026-02-01")
            .expect("both rows should be written");

    let (experiments, results): (i64, i64) = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM experiments), (SELECT COUNT(*) FROM performance_results)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("counts should read");
    assert_eq!((experiments, results), (1, 1));

    let (linked, friction, repeats): (String, f64, i64) = connection
        .query_row(
            "SELECT experiment_id, average_friction_coefficient, repeat_count
             FROM performance_results WHERE id = ?1",
            rusqlite::params![&result_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the result should be readable");
    assert_eq!(linked, experiment_id);
    assert_eq!(friction, 0.081);
    assert_eq!(repeats, 3);
}

#[test]
fn a_rejected_payload_never_reaches_the_database() {
    let connection = workspace_with_one_formulation();

    // Every one of these trips a rule in `validate`, before a statement is prepared.
    for payload in [
        json!({ "testType": "SRV" }),      // no formulation
        json!({ "formulationId": "f-1" }), // no test type
        json!({ "formulationId": "f-1", "testType": "SRV", "repeatCount": 0 }),
        json!({ "formulationId": "f-1", "testType": "SRV", "durationValue": -1 }),
        json!({ "formulationId": "f-1", "testType": "SRV", "loadValue": "not a number" }),
    ] {
        let refused = serde_json::from_value::<ExperimentWithPerformanceRequest>(payload.clone())
            .map_err(|err| err.to_string())
            .and_then(|request| request.validate())
            .is_err();
        assert!(refused, "{payload} should have been refused");
    }

    let experiments: i64 = connection
        .query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0))
        .expect("the count should read");
    assert_eq!(experiments, 0);
}
