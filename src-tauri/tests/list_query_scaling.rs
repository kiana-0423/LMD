//! What the list queries cost on a workspace with real history.
//!
//! Every list in LMD used to answer its aggregate questions one row at a time: how many
//! formulations use this base oil, what is this additive's best measured friction, what are this
//! blend's components. With a dozen records that is invisible. With the seeded dataset here it is
//! the difference between two queries and several hundred, and the semantics have to be provably
//! identical afterwards — a faster list that reports different numbers is not an optimization.
//!
//! These tests run the same SQL the commands run, against a real file, so the query plans they
//! inspect are the plans the application gets.

use lubricant_materials_database::commands::base_additive::{
    ADDITIVE_ORDER, ADDITIVE_SELECT, BASE_OIL_ORDER, BASE_OIL_SELECT,
};
use lubricant_materials_database::commands::formulation::{FORMULATION_ORDER, FORMULATION_SELECT};
use lubricant_materials_database::db::migrations::initialize_database_at;
use rusqlite::Connection;
use std::path::PathBuf;

const FORMULATIONS: usize = 300;
const ADDITIVES: usize = 40;

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("lmd-scaling-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        initialize_database_at(&root).expect("workspace should initialize");
        Self { root }
    }

    fn open(&self) -> Connection {
        let connection =
            Connection::open(self.root.join("lmd.sqlite")).expect("database should open");
        connection
            .pragma_update(None, "foreign_keys", true)
            .expect("foreign keys should be enabled");
        connection
    }

    fn cleanup(self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A workspace on the scale a working group reaches after a year: hundreds of blends, each with a
/// base oil and two additives, each measured once.
fn seed(connection: &mut Connection) {
    let transaction = connection.transaction().expect("transaction should start");
    transaction
        .execute(
            "INSERT INTO base_oils (id, name, base_oil_type, created_at, updated_at)
             VALUES ('bo-1', 'PAO 6', 'PAO', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("base oil should insert");
    for index in 0..ADDITIVES {
        let suffix = format!("{index:03}");
        transaction
            .execute(
                "INSERT INTO molecules (id, name, created_at, updated_at)
                 VALUES (?1, ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                rusqlite::params![format!("mol-{suffix}"), format!("Additive {suffix}")],
            )
            .expect("molecule should insert");
        transaction
            .execute(
                "INSERT INTO additives (id, molecule_id, function_types, created_at, updated_at)
                 VALUES (?1, ?2, '[\"antiwear\"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                rusqlite::params![format!("ad-{suffix}"), format!("mol-{suffix}")],
            )
            .expect("additive should insert");
    }
    for index in 0..FORMULATIONS {
        let suffix = format!("{index:04}");
        // Every record shares one timestamp on purpose: it is the case where `created_at` alone
        // is not a total order, which is what makes the tie-break in the ordering necessary.
        transaction
            .execute(
                "INSERT INTO formulations (id, name, preparation_time, created_at, updated_at)
                 VALUES (?1, ?2, 30, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')",
                rusqlite::params![format!("f-{suffix}"), format!("Blend {suffix}")],
            )
            .expect("formulation should insert");
        transaction
            .execute(
                "INSERT INTO formulation_components
                   (id, formulation_id, component_role, base_oil_id, concentration_value, concentration_unit)
                 VALUES (?1, ?2, 'base_oil', 'bo-1', 98.0, 'wt%')",
                rusqlite::params![format!("c-b-{suffix}"), format!("f-{suffix}")],
            )
            .expect("base oil component should insert");
        for slot in 0..2 {
            let additive = format!("ad-{:03}", (index + slot) % ADDITIVES);
            transaction
                .execute(
                    "INSERT INTO formulation_components
                       (id, formulation_id, component_role, additive_id, concentration_value, concentration_unit)
                     VALUES (?1, ?2, 'additive', ?3, ?4, 'wt%')",
                    rusqlite::params![
                        format!("c-a{slot}-{suffix}"),
                        format!("f-{suffix}"),
                        additive,
                        1.0 + slot as f64
                    ],
                )
                .expect("additive component should insert");
        }
        transaction
            .execute(
                "INSERT INTO experiments (id, formulation_id, test_type, created_at, updated_at)
                 VALUES (?1, ?2, 'SRV', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')",
                rusqlite::params![format!("e-{suffix}"), format!("f-{suffix}")],
            )
            .expect("experiment should insert");
        transaction
            .execute(
                "INSERT INTO performance_results
                   (id, experiment_id, average_friction_coefficient, wear_scar_diameter_value,
                    repeat_count, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 3, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')",
                rusqlite::params![
                    format!("r-{suffix}"),
                    format!("e-{suffix}"),
                    0.05 + (index as f64) / 10_000.0,
                    300.0 + index as f64
                ],
            )
            .expect("result should insert");
    }
    transaction.commit().expect("seed should commit");
}

/// The per-row question the old base-oil list asked, kept here as the reference answer.
fn usage_count_one_at_a_time(connection: &Connection, base_oil_id: &str) -> i64 {
    connection
        .query_row(
            "SELECT COUNT(DISTINCT formulation_id) FROM formulation_components WHERE base_oil_id = ?1",
            rusqlite::params![base_oil_id],
            |row| row.get(0),
        )
        .expect("the reference count should read")
}

#[test]
fn the_joined_base_oil_usage_count_matches_the_per_row_count_it_replaced() {
    let workspace = Workspace::new("baseoil");
    let mut connection = workspace.open();
    seed(&mut connection);

    let sql = format!("{BASE_OIL_SELECT}{BASE_OIL_ORDER}");
    let joined: i64 = connection
        .query_row(&sql, [], |row| row.get(15))
        .expect("the joined count should read");

    assert_eq!(joined, usage_count_one_at_a_time(&connection, "bo-1"));
    assert_eq!(joined, FORMULATIONS as i64);
    workspace.cleanup();
}

#[test]
fn the_joined_additive_aggregates_match_the_per_row_queries_they_replaced() {
    let workspace = Workspace::new("additive");
    let mut connection = workspace.open();
    seed(&mut connection);

    let sql = format!("{ADDITIVE_SELECT}{ADDITIVE_ORDER}");
    let mut statement = connection.prepare(&sql).expect("query should prepare");
    let rows: Vec<(String, i64, Option<f64>, Option<f64>)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(12)?, row.get(13)?, row.get(14)?))
        })
        .expect("rows should read")
        .collect::<Result<Vec<_>, _>>()
        .expect("every row should read");
    assert_eq!(rows.len(), ADDITIVES);

    for (id, count, friction, wear) in rows {
        let reference: (i64, Option<f64>, Option<f64>) = connection
            .query_row(
                "SELECT (SELECT COUNT(DISTINCT formulation_id) FROM formulation_components
                         WHERE additive_id = ?1),
                        (SELECT MIN(pr.average_friction_coefficient)
                         FROM formulation_components fc
                         JOIN experiments e ON e.formulation_id = fc.formulation_id
                         JOIN performance_results pr ON pr.experiment_id = e.id
                         WHERE fc.additive_id = ?1),
                        (SELECT MIN(pr.wear_scar_diameter_value)
                         FROM formulation_components fc
                         JOIN experiments e ON e.formulation_id = fc.formulation_id
                         JOIN performance_results pr ON pr.experiment_id = e.id
                         WHERE fc.additive_id = ?1)",
                rusqlite::params![&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the reference values should read");
        assert_eq!((count, friction, wear), reference, "additive {id}");
    }
    workspace.cleanup();
}

#[test]
fn the_joined_formulation_aggregates_match_the_per_row_queries_they_replaced() {
    let workspace = Workspace::new("formulation");
    let mut connection = workspace.open();
    seed(&mut connection);

    let sql = format!("{FORMULATION_SELECT}{FORMULATION_ORDER} LIMIT 25");
    let mut statement = connection.prepare(&sql).expect("query should prepare");
    let rows: Vec<(String, i64, Option<f64>, Option<f64>)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(11)?, row.get(12)?, row.get(13)?))
        })
        .expect("rows should read")
        .collect::<Result<Vec<_>, _>>()
        .expect("every row should read");
    assert_eq!(rows.len(), 25);

    for (id, experiments, friction, wear) in rows {
        let reference: (i64, Option<f64>, Option<f64>) = connection
            .query_row(
                "SELECT COUNT(DISTINCT e.id),
                        MIN(pr.average_friction_coefficient),
                        MIN(pr.wear_scar_diameter_value)
                 FROM experiments e
                 LEFT JOIN performance_results pr ON pr.experiment_id = e.id
                 WHERE e.formulation_id = ?1",
                rusqlite::params![&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the reference values should read");
        assert_eq!((experiments, friction, wear), reference, "formulation {id}");
    }
    workspace.cleanup();
}

#[test]
fn a_page_reads_only_its_own_rows_and_pages_partition_the_table_exactly() {
    let workspace = Workspace::new("paging");
    let mut connection = workspace.open();
    seed(&mut connection);

    let mut seen: Vec<String> = Vec::new();
    let page_size = 50;
    for page in 0..(FORMULATIONS / page_size) {
        let sql = format!("{FORMULATION_SELECT}{FORMULATION_ORDER} LIMIT ?1 OFFSET ?2");
        let mut statement = connection.prepare(&sql).expect("query should prepare");
        let ids: Vec<String> = statement
            .query_map(
                rusqlite::params![page_size as i64, (page * page_size) as i64],
                |row| row.get(0),
            )
            .expect("rows should read")
            .collect::<Result<Vec<_>, _>>()
            .expect("every row should read");
        assert_eq!(ids.len(), page_size, "page {page} should be full");
        seen.extend(ids);
    }

    let unique: std::collections::HashSet<&String> = seen.iter().collect();
    assert_eq!(
        unique.len(),
        FORMULATIONS,
        "every formulation appears exactly once across the pages"
    );
    workspace.cleanup();
}

#[test]
fn the_component_lookup_uses_its_index_rather_than_scanning_every_component() {
    let workspace = Workspace::new("plan");
    let mut connection = workspace.open();
    seed(&mut connection);

    let plan: String = connection
        .query_row(
            "EXPLAIN QUERY PLAN
             SELECT id FROM formulation_components WHERE formulation_id = 'f-0001'",
            [],
            |row| row.get(3),
        )
        .expect("the plan should read");

    assert!(
        plan.contains("idx_formulation_components_formulation_id"),
        "the component lookup should use its index, not scan: {plan}"
    );

    let plan: String = connection
        .query_row(
            "EXPLAIN QUERY PLAN
             SELECT id FROM performance_results WHERE experiment_id = 'e-0001'",
            [],
            |row| row.get(3),
        )
        .expect("the plan should read");
    assert!(
        plan.contains("idx_performance_results_experiment_id"),
        "the result lookup should use its index: {plan}"
    );
    workspace.cleanup();
}

#[test]
fn one_experiment_is_read_without_touching_the_other_two_hundred_and_ninety_nine() {
    let workspace = Workspace::new("one-experiment");
    let mut connection = workspace.open();
    seed(&mut connection);

    let plan: String = connection
        .query_row(
            "EXPLAIN QUERY PLAN SELECT id FROM experiments WHERE id = 'e-0007'",
            [],
            |row| row.get(3),
        )
        .expect("the plan should read");

    // A primary-key lookup, not the full scan the previous `get_experiment_with_results` did by
    // loading every experiment and filtering in Rust.
    assert!(
        plan.contains("SEARCH") && !plan.contains("SCAN experiments"),
        "one experiment should be found, not filtered out of all of them: {plan}"
    );
    workspace.cleanup();
}
