//! Partial updates against a real database file.
//!
//! Two properties matter and pull in opposite directions. A caller must be able to *clear* a field
//! — an empty note, a measurement that turned out to be wrong — which `COALESCE` cannot express.
//! And a caller must not be able to *lose* an edit silently: a value of the wrong shape has to come
//! back as an error, never as a quietly ignored no-op.

use lubricant_materials_database::commands::base_additive::apply_base_oil_patch;
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
            "lmd-patch-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace should be created");
        let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
        connection
            .execute_batch(schema())
            .expect("schema should initialize");
        connection
            .execute_batch(
                "INSERT INTO base_oils
                   (id, name, base_oil_type, viscosity_40c, viscosity_100c, density, supplier,
                    notes, created_at, updated_at)
                 VALUES ('bo-1', 'PAO-6', 'PAO', 32.0, 6.0, 0.83, 'Acme', 'original note',
                         '2026-01-01', '2026-01-01');",
            )
            .expect("base oil should insert");
        Self { root }
    }

    fn open(&self) -> Connection {
        Connection::open(self.root.join("lmd.sqlite")).expect("database should open")
    }

    fn row(
        &self,
    ) -> (
        String,
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<String>,
    ) {
        self.open()
            .query_row(
                "SELECT name, viscosity_40c, density, supplier, notes FROM base_oils
                 WHERE id = 'bo-1'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("row should read")
    }

    fn cleanup(self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn an_absent_field_is_left_exactly_as_it_was() {
    let workspace = Workspace::new("absent");
    let connection = workspace.open();

    apply_base_oil_patch(
        &connection,
        "bo-1",
        &json!({ "supplier": "Beta Oils" }),
        None,
        "2026-02-01",
    )
    .expect("the patch should apply");

    let (name, viscosity, density, supplier, notes) = workspace.row();
    assert_eq!(name, "PAO-6");
    assert_eq!(viscosity, Some(32.0));
    assert_eq!(density, Some(0.83));
    assert_eq!(supplier.as_deref(), Some("Beta Oils"));
    assert_eq!(notes.as_deref(), Some("original note"));
    workspace.cleanup();
}

#[test]
fn a_null_clears_a_measurement_and_an_empty_string_clears_a_note() {
    let workspace = Workspace::new("clear");
    let connection = workspace.open();

    apply_base_oil_patch(
        &connection,
        "bo-1",
        &json!({ "viscosity40c": null, "notes": "" }),
        None,
        "2026-02-01",
    )
    .expect("the patch should apply");

    let (_, viscosity, _, _, notes) = workspace.row();
    assert_eq!(viscosity, None, "a measurement can be removed");
    assert_eq!(notes.as_deref(), Some(""), "a note can be emptied");
    workspace.cleanup();
}

#[test]
fn zero_is_stored_as_zero_rather_than_read_as_an_absence() {
    let workspace = Workspace::new("zero");
    let connection = workspace.open();

    apply_base_oil_patch(
        &connection,
        "bo-1",
        &json!({ "density": 0 }),
        None,
        "2026-02-01",
    )
    .expect("the patch should apply");

    assert_eq!(workspace.row().2, Some(0.0));
    workspace.cleanup();
}

#[test]
fn an_invalid_number_is_refused_and_the_row_is_untouched() {
    let workspace = Workspace::new("invalid-number");
    let connection = workspace.open();
    let before = workspace.row();

    let error = apply_base_oil_patch(
        &connection,
        "bo-1",
        // The supplier change is valid; the viscosity is not. Neither may be applied.
        &json!({ "supplier": "Beta Oils", "viscosity40c": "12a" }),
        None,
        "2026-02-01",
    )
    .expect_err("a non-numeric viscosity must be refused");

    assert!(error.contains("viscosity40c"), "{error}");
    assert!(error.contains("12a"), "{error}");
    assert_eq!(
        workspace.row(),
        before,
        "a rejected patch must not apply its valid fields either"
    );
    workspace.cleanup();
}

#[test]
fn a_value_of_the_wrong_json_type_is_refused_rather_than_ignored() {
    let workspace = Workspace::new("wrong-type");
    let connection = workspace.open();
    let before = workspace.row();

    for payload in [
        json!({ "density": ["0.9"] }),
        json!({ "density": { "value": 0.9 } }),
        json!({ "notes": ["a note"] }),
    ] {
        let error = apply_base_oil_patch(&connection, "bo-1", &payload, None, "2026-02-01")
            .expect_err("a value of the wrong shape must be refused");
        assert!(
            error.contains("must be"),
            "the message should say what the field needs: {error}"
        );
    }

    assert_eq!(workspace.row(), before);
    workspace.cleanup();
}

#[test]
fn a_required_name_cannot_be_emptied() {
    let workspace = Workspace::new("required");
    let connection = workspace.open();

    for payload in [
        json!({ "name": "" }),
        json!({ "name": null }),
        json!({ "name": "  " }),
    ] {
        let error = apply_base_oil_patch(&connection, "bo-1", &payload, None, "2026-02-01")
            .expect_err("a base oil must keep its name");
        assert!(error.contains("base oil name"), "{error}");
    }

    assert_eq!(workspace.row().0, "PAO-6");
    workspace.cleanup();
}

#[test]
fn a_cleared_field_stays_cleared_after_the_database_is_reopened() {
    let workspace = Workspace::new("reopen");
    {
        let connection = workspace.open();
        apply_base_oil_patch(
            &connection,
            "bo-1",
            &json!({ "density": null, "notes": "" }),
            None,
            "2026-02-01",
        )
        .expect("the patch should apply");
    }

    // A brand-new connection, as a restarted application would open.
    let (_, _, density, _, notes) = workspace.row();
    assert_eq!(density, None);
    assert_eq!(notes.as_deref(), Some(""));
    workspace.cleanup();
}
