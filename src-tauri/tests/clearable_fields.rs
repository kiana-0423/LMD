//! Proves that optional values can be emptied, using the exact SQL shape the update commands run.
//!
//! The previous `COALESCE(?, column)` form silently treated an explicit clear as "field omitted",
//! so a user could never remove a note or withdraw a measurement.

use rusqlite::{params, Connection};

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

fn connection() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
    connection
        .execute_batch(schema())
        .expect("schema should initialize");
    connection
        .execute_batch(
            r#"
            INSERT INTO base_oils
              (id, name, base_oil_type, viscosity_40c, density, supplier, batch_number, notes,
               created_at, updated_at)
              VALUES ('bo-1', 'PAO-6', 'PAO', 32.0, 0.83, 'Example Supplier', 'B-2401',
                      'Original note', '2026-01-01', '2026-01-01');
            "#,
        )
        .expect("fixtures should insert");
    connection
}

/// The generated statement: a keep flag decides between the stored value and the supplied one.
fn update_notes_and_density(
    connection: &Connection,
    keep_notes: bool,
    notes: Option<&str>,
    keep_density: bool,
    density: Option<f64>,
) {
    connection
        .execute(
            "UPDATE base_oils SET
                notes = CASE WHEN ?2 THEN notes ELSE ?3 END,
                density = CASE WHEN ?4 THEN density ELSE ?5 END,
                updated_at = '2026-02-01'
             WHERE id = ?1",
            params!["bo-1", keep_notes, notes, keep_density, density],
        )
        .expect("update should apply");
}

fn read(connection: &Connection) -> (Option<String>, Option<f64>, String, String) {
    connection
        .query_row(
            "SELECT notes, density, name, supplier FROM base_oils WHERE id = 'bo-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("row should read")
}

#[test]
fn an_omitted_field_keeps_its_stored_value() {
    let connection = connection();

    update_notes_and_density(&connection, true, None, true, None);

    let (notes, density, _, _) = read(&connection);
    assert_eq!(notes.as_deref(), Some("Original note"));
    assert_eq!(density, Some(0.83));
}

#[test]
fn an_explicit_clear_empties_a_text_field_without_touching_the_rest() {
    let connection = connection();

    update_notes_and_density(&connection, false, Some(""), true, None);

    let (notes, density, name, supplier) = read(&connection);
    assert_eq!(notes.as_deref(), Some(""), "the note is now empty");
    // Unrelated columns are untouched.
    assert_eq!(density, Some(0.83));
    assert_eq!(name, "PAO-6");
    assert_eq!(supplier, "Example Supplier");
}

#[test]
fn an_explicit_null_stores_sql_null() {
    let connection = connection();

    update_notes_and_density(&connection, false, None, false, None);

    let (notes, density, _, _) = read(&connection);
    assert_eq!(notes, None, "the note is NULL, not the old text");
    assert_eq!(density, None, "the measurement is withdrawn");
}

#[test]
fn zero_is_stored_as_zero_rather_than_treated_as_missing() {
    let connection = connection();

    update_notes_and_density(&connection, true, None, false, Some(0.0));

    let (_, density, _, _) = read(&connection);
    assert_eq!(density, Some(0.0), "a genuine zero must survive");
}

#[test]
fn a_cleared_measurement_survives_a_reopen() {
    let path = std::env::temp_dir().join(format!("lmd-clearable-{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&path);
    {
        let connection = Connection::open(&path).expect("database should open");
        connection
            .pragma_update(None, "foreign_keys", true)
            .expect("foreign keys should be enabled");
        connection.execute_batch(schema()).expect("schema");
        // Foreign keys are on in the app, so the parent chain has to exist.
        connection
            .execute_batch(
                r#"
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('f-1', 'Blend', '2026-01-01', '2026-01-01');
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('e-1', 'f-1', '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("parent rows should insert");
        connection
            .execute(
                "INSERT INTO performance_results
                   (id, experiment_id, average_friction_coefficient, notes, created_at, updated_at)
                 VALUES ('r-1', 'e-1', 0.082, 'Suspect run', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("result should insert");
        connection
            .execute(
                "UPDATE performance_results SET
                    average_friction_coefficient =
                        CASE WHEN ?2 THEN average_friction_coefficient ELSE ?3 END,
                    notes = CASE WHEN ?4 THEN notes ELSE ?5 END
                 WHERE id = ?1",
                params!["r-1", false, None::<f64>, false, ""],
            )
            .expect("update should apply");
    }

    let connection = Connection::open(&path).expect("database should reopen");
    let (friction, notes): (Option<f64>, Option<String>) = connection
        .query_row(
            "SELECT average_friction_coefficient, notes FROM performance_results WHERE id = 'r-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("row should read");

    assert_eq!(friction, None, "the withdrawn measurement stays withdrawn");
    assert_eq!(notes.as_deref(), Some(""));
    let _ = std::fs::remove_file(&path);
}
