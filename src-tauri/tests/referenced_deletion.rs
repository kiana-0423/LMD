//! Deleting a catalogued record must not quietly rewrite somebody's recorded science.
//!
//! `DELETE FROM formulation_components WHERE base_oil_id = ?` is a statement that always succeeds.
//! What it did was remove the base oil from every blend that used it, leaving formulations whose
//! remaining additive percentages describe a mixture that cannot exist — with nothing anywhere
//! saying so. These tests pin the refusal, the report that comes with it, and the explicit cascade
//! that is now the only way to get the old behaviour.

use lubricant_materials_database::commands::references::{
    affected_formulations, blocked_message, require_cascade_confirmation, ComponentLink,
};
use rusqlite::Connection;

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

fn workspace() -> Connection {
    let connection = Connection::open_in_memory().expect("sqlite should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled");
    connection
        .execute_batch(schema())
        .expect("schema should initialize");
    connection
        .execute_batch(
            r#"
            INSERT INTO molecules (id, name, created_at, updated_at)
              VALUES ('m-zddp', 'ZDDP', '2026-01-01', '2026-01-01');
            INSERT INTO base_oils (id, name, created_at, updated_at)
              VALUES ('bo-pao6', 'PAO 6', '2026-01-01', '2026-01-01'),
                     ('bo-unused', 'Mistyped Oil', '2026-01-01', '2026-01-01');
            INSERT INTO additives (id, molecule_id, created_at, updated_at)
              VALUES ('ad-zddp', 'm-zddp', '2026-01-01', '2026-01-01');
            INSERT INTO formulations (id, name, created_at, updated_at)
              VALUES ('f-1', 'PAO 6 + ZDDP 1%', '2026-01-02', '2026-01-02'),
                     ('f-2', 'PAO 6 + ZDDP 2%', '2026-01-03', '2026-01-03');
            INSERT INTO formulation_components
              (id, formulation_id, component_role, base_oil_id, concentration_value, concentration_unit)
              VALUES ('c-1', 'f-1', 'base_oil', 'bo-pao6', 99, 'wt%'),
                     ('c-3', 'f-2', 'base_oil', 'bo-pao6', 98, 'wt%');
            INSERT INTO formulation_components
              (id, formulation_id, component_role, additive_id, concentration_value, concentration_unit)
              VALUES ('c-2', 'f-1', 'additive', 'ad-zddp', 1, 'wt%'),
                     ('c-4', 'f-2', 'additive', 'ad-zddp', 2, 'wt%');
            "#,
        )
        .expect("fixture should insert");
    connection
}

/// The safe delete, expressed exactly as `base_additive::delete_base_oil` expresses it.
fn safe_delete(connection: &Connection, link: ComponentLink, table: &str, id: &str) -> bool {
    let affected = affected_formulations(connection, link, id).expect("references should read");
    if !affected.is_empty() {
        return false;
    }
    connection
        .execute(
            &format!("DELETE FROM {table} WHERE id = ?1"),
            rusqlite::params![id],
        )
        .expect("an unreferenced row deletes cleanly")
        > 0
}

#[test]
fn a_referenced_base_oil_is_not_deleted_and_no_component_is_touched() {
    let connection = workspace();

    let deleted = safe_delete(&connection, ComponentLink::BaseOil, "base_oils", "bo-pao6");

    assert!(!deleted, "a referenced base oil must not be deleted");
    let (oils, components): (i64, i64) = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM base_oils WHERE id = 'bo-pao6'),
                    (SELECT COUNT(*) FROM formulation_components)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("counts should read");
    assert_eq!(oils, 1, "the base oil is still there");
    assert_eq!(
        components, 4,
        "not one formulation component was silently removed"
    );
}

#[test]
fn the_refusal_names_every_affected_formulation() {
    let connection = workspace();

    let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-pao6")
        .expect("references should read");

    assert_eq!(affected.len(), 2);
    let names: Vec<&str> = affected
        .iter()
        .map(|item| item.formulation_name.as_str())
        .collect();
    assert!(names.contains(&"PAO 6 + ZDDP 1%"));
    assert!(names.contains(&"PAO 6 + ZDDP 2%"));

    let message = blocked_message(ComponentLink::BaseOil, &affected);
    assert!(message.contains("[delete.blockedByReferences]"));
    assert!(message.contains("PAO 6 + ZDDP 1%"));
}

#[test]
fn a_referenced_additive_is_refused_the_same_way() {
    let connection = workspace();

    let deleted = safe_delete(&connection, ComponentLink::Additive, "additives", "ad-zddp");

    assert!(!deleted);
    let components: i64 = connection
        .query_row("SELECT COUNT(*) FROM formulation_components", [], |row| {
            row.get(0)
        })
        .expect("count should read");
    assert_eq!(components, 4);
}

#[test]
fn an_unreferenced_record_still_deletes_cleanly() {
    let connection = workspace();

    let deleted = safe_delete(
        &connection,
        ComponentLink::BaseOil,
        "base_oils",
        "bo-unused",
    );

    assert!(deleted, "a mistyped record nobody used has to be removable");
    let remaining: i64 = connection
        .query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0))
        .expect("count should read");
    assert_eq!(remaining, 1);
}

#[test]
fn a_cascade_requires_explicit_confirmation_and_then_reports_everything_it_removed() {
    let mut connection = workspace();
    let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-pao6")
        .expect("references should read");

    // Without the acknowledgement, nothing happens and the caller is told what it would cost.
    let refusal = require_cascade_confirmation(false, ComponentLink::BaseOil, &affected)
        .expect_err("an unconfirmed cascade is refused");
    assert!(refusal.contains("[delete.cascadeNotConfirmed]"));
    assert!(refusal.contains("2 component(s)"));

    require_cascade_confirmation(true, ComponentLink::BaseOil, &affected)
        .expect("a confirmed cascade proceeds");
    let transaction = connection.transaction().expect("transaction should start");
    let removed = transaction
        .execute(
            "DELETE FROM formulation_components WHERE base_oil_id = 'bo-pao6'",
            [],
        )
        .expect("components should be removed");
    transaction
        .execute("DELETE FROM base_oils WHERE id = 'bo-pao6'", [])
        .expect("the oil should be removed");
    transaction.commit().expect("cascade should commit");

    assert_eq!(removed, 2);
    // Every formulation that lost a component is in the report the caller already holds.
    assert_eq!(affected.len(), 2);
    assert_eq!(
        affected
            .iter()
            .map(|item| item.component_count)
            .sum::<i64>(),
        removed as i64
    );
}
