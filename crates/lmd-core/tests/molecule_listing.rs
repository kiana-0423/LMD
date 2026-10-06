//! The molecule-listing service on its own: no desktop crate, no Tauri runtime, no workspace
//! resolution — a connection is handed to it and nothing else.
//!
//! The database is in-memory SQLite with the shipped schema. That schema is still owned by the
//! desktop crate; its generated plain-SQL copy is read here so these tests cannot drift from it.
//! The same scenarios run in `src-tauri/tests/molecule_listing_service.rs` against a workspace
//! created by the production initializer.

#[macro_use]
#[path = "support/molecule_listing.rs"]
mod molecule_listing_scenarios;

use lmd_core::molecules::{list_molecules, MoleculeListFilter};
use rusqlite::Connection;
use serde_json::json;

const SCHEMA: &str = include_str!("../../../src-tauri/src/db/schema_for_tests.sql");

fn in_memory_workspace(_name: &str, scenario: fn(&mut Connection)) {
    let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
    connection
        .execute_batch(SCHEMA)
        .expect("schema should initialize");
    scenario(&mut connection);
}

molecule_listing_tests!(in_memory_workspace);

#[test]
fn an_absent_filter_is_the_default_and_a_malformed_one_is_refused() {
    let filter = MoleculeListFilter::from_json(None).expect("no filter is the default filter");
    assert_eq!((filter.page, filter.page_size), (0, 0));
    assert!(filter.search.is_empty());
    let partial = MoleculeListFilter::from_json(Some(json!({ "category": "additive" })))
        .expect("missing fields take their defaults");
    assert_eq!(partial.category, "additive");
    assert!(partial.element.is_empty());

    let error = MoleculeListFilter::from_json(Some(json!({ "page": "two" })))
        .expect_err("a non-numeric page is malformed");
    assert!(
        error.starts_with("Invalid molecule list filter: "),
        "unexpected error: {error}"
    );
}

#[test]
fn a_database_without_the_library_reports_the_failing_step() {
    let connection = Connection::open_in_memory().expect("in-memory sqlite should open");

    let error = list_molecules(&connection, MoleculeListFilter::default())
        .expect_err("a database with no molecules table cannot be listed");
    assert!(
        error.starts_with("Failed to count filtered molecules: "),
        "unexpected error: {error}"
    );
}
