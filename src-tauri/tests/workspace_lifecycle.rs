//! End-to-end workspace lifecycle against a real SQLite file.
//!
//! This exercises the same statements the Tauri commands run — creating a workspace, importing
//! more than twenty rows, editing and deleting records, and reopening the file — without needing
//! a running Tauri application.

use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

fn temp_workspace(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("lmd-integration-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("files/models")).expect("workspace should be created");
    std::fs::create_dir_all(root.join("exports")).expect("exports should be created");
    root
}

fn open(path: &Path) -> Connection {
    let connection = Connection::open(path.join("lmd.sqlite")).expect("database should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled");
    connection
}

fn seed_schema(connection: &Connection) {
    connection
        .execute_batch(schema())
        .expect("schema should initialize");
}

#[test]
fn a_workspace_survives_import_edit_delete_and_reopen() {
    let workspace = temp_workspace("lifecycle");
    {
        let connection = open(&workspace);
        seed_schema(&connection);

        // --- Import more than twenty rows in one transaction, as the CSV import does. ---
        let mut connection = connection;
        let tx = connection.transaction().expect("transaction should start");
        for index in 0..25 {
            let suffix = format!("{index:03}");
            tx.execute(
                "INSERT INTO base_oils (id, name, base_oil_type, viscosity_40c, created_at, updated_at)
                 VALUES (?1, ?2, 'PAO', ?3, '2026-01-01', '2026-01-01')",
                params![
                    format!("bo-{suffix}"),
                    format!("Base Oil {suffix}"),
                    30.0 + index as f64
                ],
            )
            .expect("base oil should insert");
        }
        tx.commit().expect("import should commit");

        let imported: i64 = connection
            .query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0))
            .expect("count should read");
        assert_eq!(imported, 25, "every imported row must be persisted");

        // --- Edit a record. ---
        connection
            .execute(
                "UPDATE base_oils SET name = ?2, viscosity_40c = ?3, updated_at = ?4 WHERE id = ?1",
                params!["bo-000", "Renamed Base Oil", 41.5, "2026-02-01"],
            )
            .expect("update should apply");

        // --- Delete a record. ---
        let deleted = connection
            .execute("DELETE FROM base_oils WHERE id = 'bo-024'", [])
            .expect("delete should apply");
        assert_eq!(deleted, 1);
    }

    // --- Reopen the workspace and verify persistence. ---
    let connection = open(&workspace);
    let (name, viscosity, updated): (String, f64, String) = connection
        .query_row(
            "SELECT name, viscosity_40c, updated_at FROM base_oils WHERE id = 'bo-000'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the edited row should still exist");
    assert_eq!(name, "Renamed Base Oil");
    assert!((viscosity - 41.5).abs() < 1e-9);
    assert_eq!(updated, "2026-02-01");

    let remaining: i64 = connection
        .query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0))
        .expect("count should read");
    assert_eq!(remaining, 24, "the delete must survive a reopen");

    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn referential_integrity_is_enforced_across_a_reopen() {
    let workspace = temp_workspace("integrity");
    {
        let connection = open(&workspace);
        seed_schema(&connection);
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('mol-1', 'Ethanol', '2026-01-01', '2026-01-01');
                INSERT INTO additives (id, molecule_id, created_at, updated_at)
                  VALUES ('add-1', 'mol-1', '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("fixtures should insert");
    }

    let connection = open(&workspace);
    // A referenced molecule cannot be removed without clearing its dependants first.
    let error = connection
        .execute("DELETE FROM molecules WHERE id = 'mol-1'", [])
        .expect_err("the delete must be refused");
    assert!(error.to_string().contains("FOREIGN KEY"));

    // Removing the dependant first makes the delete legal.
    connection
        .execute("DELETE FROM additives WHERE id = 'add-1'", [])
        .expect("additive should delete");
    connection
        .execute("DELETE FROM molecules WHERE id = 'mol-1'", [])
        .expect("molecule should now delete");

    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn a_multi_table_change_rolls_back_completely_when_one_statement_fails() {
    let workspace = temp_workspace("rollback");
    let mut connection = open(&workspace);
    seed_schema(&connection);
    connection
        .execute(
            "INSERT INTO formulations (id, name, created_at, updated_at)
             VALUES ('form-1', 'Base', '2026-01-01', '2026-01-01')",
            [],
        )
        .expect("formulation should insert");

    {
        let tx = connection.transaction().expect("transaction should start");
        tx.execute(
            "INSERT INTO experiments (id, formulation_id, created_at, updated_at)
             VALUES ('exp-1', 'form-1', '2026-01-01', '2026-01-01')",
            [],
        )
        .expect("experiment should insert");
        // Referencing a formulation that does not exist must abort the whole change.
        let failure = tx.execute(
            "INSERT INTO experiments (id, formulation_id, created_at, updated_at)
             VALUES ('exp-2', 'missing-formulation', '2026-01-01', '2026-01-01')",
            [],
        );
        assert!(failure.is_err());
        // Dropping the transaction without committing rolls everything back.
    }

    let experiments: i64 = connection
        .query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0))
        .expect("count should read");
    assert_eq!(
        experiments, 0,
        "the successful insert must not survive a rolled-back transaction"
    );

    let _ = std::fs::remove_dir_all(&workspace);
}

/// Builds a workspace where descriptor values track the measured target, so a correlation query
/// has a known answer.
fn seeded_analysis_workspace(name: &str) -> (PathBuf, Connection) {
    let workspace = temp_workspace(name);
    let connection = open(&workspace);
    seed_schema(&connection);
    for index in 0..8 {
        let suffix = format!("{index:03}");
        connection
            .execute_batch(&format!(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('mol-{suffix}', 'Molecule {suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO molecule_descriptors
                  (id, molecule_id, descriptor_set, descriptors_json, descriptor_count, status,
                   mode, calculated_at)
                  VALUES ('d-{suffix}', 'mol-{suffix}', 'rdkit', '{{"MolWt": {weight}}}', 1,
                          'calculated', 'real', '2026-01-01');
                INSERT INTO additives (id, molecule_id, created_at, updated_at)
                  VALUES ('add-{suffix}', 'mol-{suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('form-{suffix}', 'Formulation {suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, additive_id, concentration_value)
                  VALUES ('comp-{suffix}', 'form-{suffix}', 'additive', 'add-{suffix}', 1.0);
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('exp-{suffix}', 'form-{suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO performance_results
                  (id, experiment_id, average_friction_coefficient, created_at, updated_at)
                  VALUES ('res-{suffix}', 'exp-{suffix}', {friction}, '2026-01-01', '2026-01-01');
                "#,
                weight = 100.0 + index as f64 * 10.0,
                friction = 0.05 + index as f64 * 0.005,
            ))
            .expect("fixtures should insert");
    }
    (workspace, connection)
}

#[test]
fn the_correlation_join_pairs_descriptors_with_measured_results() {
    let (workspace, connection) = seeded_analysis_workspace("correlation");

    let mut statement = connection
        .prepare(
            "SELECT d.descriptors_json, r.average_friction_coefficient
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id
             JOIN formulation_components c ON c.formulation_id = e.formulation_id
             JOIN additives a ON a.id = c.additive_id
             JOIN molecule_descriptors d ON d.molecule_id = a.molecule_id
             WHERE d.mode = 'real' AND d.status = 'calculated'",
        )
        .expect("query should prepare");
    let pairs: Vec<(String, f64)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query should run")
        .collect::<Result<Vec<_>, _>>()
        .expect("rows should read");

    assert_eq!(
        pairs.len(),
        8,
        "every result must pair with its molecule's descriptors"
    );
    assert!(pairs.iter().all(|(json, _)| json.contains("MolWt")));

    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn mock_descriptor_rows_are_excluded_from_the_analysis_join() {
    let (workspace, connection) = seeded_analysis_workspace("mock-exclusion");
    connection
        .execute(
            "UPDATE molecule_descriptors SET mode = 'mock' WHERE molecule_id IN ('mol-000', 'mol-001')",
            [],
        )
        .expect("update should apply");

    let remaining: i64 = connection
        .query_row(
            "SELECT COUNT(*)
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id
             JOIN formulation_components c ON c.formulation_id = e.formulation_id
             JOIN additives a ON a.id = c.additive_id
             JOIN molecule_descriptors d ON d.molecule_id = a.molecule_id
             WHERE d.mode = 'real' AND d.status = 'calculated'",
            [],
            |row| row.get(0),
        )
        .expect("count should read");

    assert_eq!(
        remaining, 6,
        "placeholder descriptor rows must never reach an analysis"
    );

    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn deleting_an_experiment_removes_its_results_and_attachments_together() {
    let (workspace, connection) = seeded_analysis_workspace("cascade");
    let mut connection = connection;
    connection
        .execute(
            "INSERT INTO attachments
               (id, linked_entity_type, linked_entity_id, file_name, relative_path, uploaded_at)
             VALUES ('att-1', 'experiment', 'exp-000', 'curve.csv', 'files/curves/curve.csv',
                     '2026-01-01')",
            [],
        )
        .expect("attachment should insert");

    let tx = connection.transaction().expect("transaction should start");
    tx.execute(
        "DELETE FROM performance_results WHERE experiment_id = 'exp-000'",
        [],
    )
    .expect("results should delete");
    tx.execute(
        "DELETE FROM attachments WHERE linked_entity_type = 'experiment' AND linked_entity_id = 'exp-000'",
        [],
    )
    .expect("attachments should delete");
    tx.execute("DELETE FROM experiments WHERE id = 'exp-000'", [])
        .expect("experiment should delete");
    tx.commit().expect("delete should commit");

    for (table, expected) in [
        ("experiments", 7),
        ("performance_results", 7),
        ("attachments", 0),
    ] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count should read");
        assert_eq!(count, expected, "{table} should have {expected} rows left");
    }

    let _ = std::fs::remove_dir_all(&workspace);
}

/// The statements `copy_formulation` runs, so the test exercises the real transaction shape.
fn copy_formulation_rows(
    connection: &mut Connection,
    source_id: &str,
    copy_id: &str,
    copy_name: &str,
) -> Result<(), rusqlite::Error> {
    let tx = connection.transaction()?;
    tx.execute(
        "INSERT INTO formulations (
            id, name, preparation_method, preparation_temperature,
            preparation_temperature_unit, preparation_time, preparation_time_unit,
            stability_observation, notes, created_at, updated_at
         )
         SELECT ?2, ?3, preparation_method, preparation_temperature,
                preparation_temperature_unit, preparation_time, preparation_time_unit,
                stability_observation, notes, '2026-03-01', '2026-03-01'
         FROM formulations WHERE id = ?1",
        params![source_id, copy_id, copy_name],
    )?;
    let component_ids: Vec<String> = {
        let mut statement = tx.prepare(
            "SELECT id FROM formulation_components WHERE formulation_id = ?1 ORDER BY id",
        )?;
        let ids = statement
            .query_map(params![source_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };
    for (index, component_id) in component_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO formulation_components (
                id, formulation_id, component_role, molecule_id, base_oil_id, additive_id,
                concentration_value, concentration_unit, concentration_standard_value,
                concentration_standard_unit, notes
             )
             SELECT ?1, ?2, component_role, molecule_id, base_oil_id, additive_id,
                    concentration_value, concentration_unit, concentration_standard_value,
                    concentration_standard_unit, notes
             FROM formulation_components WHERE id = ?3",
            params![format!("{copy_id}-c{index}"), copy_id, component_id],
        )?;
    }
    tx.commit()
}

fn seed_copy_source(connection: &Connection) {
    connection
        .execute_batch(
            r#"
            INSERT INTO molecules (id, name, created_at, updated_at)
              VALUES ('mol-1', 'ZDDP', '2026-01-01', '2026-01-01');
            INSERT INTO base_oils (id, name, created_at, updated_at)
              VALUES ('bo-1', 'PAO-6', '2026-01-01', '2026-01-01');
            INSERT INTO additives (id, molecule_id, created_at, updated_at)
              VALUES ('add-1', 'mol-1', '2026-01-01', '2026-01-01');
            INSERT INTO formulations
              (id, name, preparation_method, preparation_temperature, notes, created_at, updated_at)
              VALUES ('form-1', 'PAO-6 + ZDDP 1.0%', 'Stirred', 60.0, 'Original notes',
                      '2026-01-01', '2026-01-01');
            INSERT INTO formulation_components
              (id, formulation_id, component_role, base_oil_id, concentration_value,
               concentration_unit)
              VALUES ('comp-1', 'form-1', 'base_oil', 'bo-1', 99.0, 'wt%');
            INSERT INTO formulation_components
              (id, formulation_id, component_role, additive_id, concentration_value,
               concentration_unit)
              VALUES ('comp-2', 'form-1', 'additive', 'add-1', 1.0, 'wt%');
            INSERT INTO experiments (id, formulation_id, created_at, updated_at)
              VALUES ('exp-1', 'form-1', '2026-01-01', '2026-01-01');
            INSERT INTO performance_results
              (id, experiment_id, average_friction_coefficient, created_at, updated_at)
              VALUES ('res-1', 'exp-1', 0.082, '2026-01-01', '2026-01-01');
            "#,
        )
        .expect("fixtures should insert");
}

#[test]
fn copying_a_formulation_duplicates_every_component_but_no_measurements() {
    let workspace = temp_workspace("copy");
    let mut connection = open(&workspace);
    seed_schema(&connection);
    seed_copy_source(&connection);

    copy_formulation_rows(
        &mut connection,
        "form-1",
        "form-copy",
        "PAO-6 + ZDDP 1.0% Copy",
    )
    .expect("the copy should commit");

    let (name, method, temperature): (String, String, f64) = connection
        .query_row(
            "SELECT name, preparation_method, preparation_temperature FROM formulations WHERE id = 'form-copy'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the copy should exist");
    assert_eq!(name, "PAO-6 + ZDDP 1.0% Copy");
    assert_eq!(method, "Stirred");
    assert!((temperature - 60.0).abs() < 1e-9);

    let components: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM formulation_components WHERE formulation_id = 'form-copy'",
            [],
            |row| row.get(0),
        )
        .expect("count should read");
    assert_eq!(components, 2, "every component must be duplicated");

    // Component ids must be fresh, and the original must be untouched.
    let shared: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM formulation_components
             WHERE formulation_id = 'form-copy' AND id IN ('comp-1', 'comp-2')",
            [],
            |row| row.get(0),
        )
        .expect("count should read");
    assert_eq!(
        shared, 0,
        "the copy must not reuse the source component ids"
    );

    // Measurements belong to the original mixture and must not follow the copy.
    let copied_experiments: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM experiments WHERE formulation_id = 'form-copy'",
            [],
            |row| row.get(0),
        )
        .expect("count should read");
    assert_eq!(copied_experiments, 0, "experiments must not be copied");

    let originals: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM formulation_components WHERE formulation_id = 'form-1'",
            [],
            |row| row.get(0),
        )
        .expect("count should read");
    assert_eq!(originals, 2, "the source formulation must be unchanged");

    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn a_failed_component_copy_leaves_no_partial_formulation_behind() {
    let workspace = temp_workspace("copy-rollback");
    let mut connection = open(&workspace);
    seed_schema(&connection);
    seed_copy_source(&connection);

    {
        let tx = connection.transaction().expect("transaction should start");
        tx.execute(
            "INSERT INTO formulations (id, name, created_at, updated_at)
             VALUES ('form-copy', 'Copy', '2026-03-01', '2026-03-01')",
            [],
        )
        .expect("the copy header should insert");
        // A component pointing at a base oil that does not exist must abort the copy.
        let failure = tx.execute(
            "INSERT INTO formulation_components (id, formulation_id, component_role, base_oil_id)
             VALUES ('bad', 'form-copy', 'base_oil', 'missing-base-oil')",
            [],
        );
        assert!(failure.is_err(), "a dangling component must be refused");
        // Dropping without commit rolls the header back too.
    }

    let copies: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM formulations WHERE id = 'form-copy'",
            [],
            |row| row.get(0),
        )
        .expect("count should read");
    assert_eq!(copies, 0, "a half-written copy must not survive");

    let _ = std::fs::remove_dir_all(&workspace);
}
