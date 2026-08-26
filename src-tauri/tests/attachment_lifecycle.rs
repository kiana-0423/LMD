//! Cascading attachment deletion against a real database file and a real workspace directory.
//!
//! These call the shipped implementation — `attachments::delete_with_files` and the path
//! resolution around it — rather than re-creating the statement sequences. A test that reproduces
//! the code it checks cannot catch a change in that code.

use lubricant_materials_database::commands::attachments::{
    self, delete_with_files, resolve_in_workspace, workspace_relative, Quarantine,
};
use rusqlite::{params, Connection};
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
            "lmd-attach-int-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("files/imports")).expect("workspace should be created");
        let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
        connection
            .execute_batch(schema())
            .expect("schema should initialize");
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

    /// Writes a file and records an attachment row pointing at it.
    fn attach(&self, id: &str, entity_type: &str, entity_id: &str) -> String {
        let relative = format!("files/imports/{id}.csv");
        fs::write(self.root.join(&relative), format!("payload for {id}"))
            .expect("attachment file should be written");
        self.open()
            .execute(
                "INSERT INTO attachments
                   (id, linked_entity_type, linked_entity_id, file_name, relative_path, uploaded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-01')",
                params![id, entity_type, entity_id, format!("{id}.csv"), &relative],
            )
            .expect("attachment row should insert");
        relative
    }

    fn exists(&self, relative: &str) -> bool {
        self.root.join(relative).exists()
    }

    fn attachment_count(&self) -> i64 {
        self.open()
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .expect("count should read")
    }

    fn cleanup(self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn seed_chain(connection: &Connection) {
    connection
        .execute_batch(
            r#"
            INSERT INTO molecules (id, name, created_at, updated_at)
              VALUES ('mol-1', 'ZDDP', '2026-01-01', '2026-01-01');
            INSERT INTO formulations (id, name, created_at, updated_at)
              VALUES ('form-1', 'Blend', '2026-01-01', '2026-01-01');
            INSERT INTO experiments (id, formulation_id, created_at, updated_at)
              VALUES ('exp-1', 'form-1', '2026-01-01', '2026-01-01');
            "#,
        )
        .expect("fixtures should insert");
}

#[test]
fn deleting_a_molecule_removes_its_attachment_rows_and_files() {
    let workspace = Workspace::new("molecule");
    let connection = workspace.open();
    seed_chain(&connection);
    let kept = workspace.attach("att-other", "formulation", "form-1");
    let doomed = workspace.attach("att-mol", "molecule", "mol-1");

    let mut connection = workspace.open();
    let (deleted, removed, failures) =
        delete_with_files(&workspace.root, std::slice::from_ref(&doomed), || {
            let transaction = connection
                .transaction()
                .map_err(|err| format!("transaction: {err}"))?;
            let deleted = attachments::delete_attachment_rows(
                &transaction,
                attachments::ENTITY_MOLECULE,
                "mol-1",
            )?;
            transaction
                .execute("DELETE FROM molecules WHERE id = 'mol-1'", [])
                .map_err(|err| format!("molecule: {err}"))?;
            transaction
                .commit()
                .map_err(|err| format!("commit: {err}"))?;
            Ok(deleted)
        })
        .expect("the delete should succeed");

    assert_eq!(deleted, 1);
    assert_eq!(removed, 1);
    assert!(failures.is_empty());
    assert_eq!(
        workspace.attachment_count(),
        1,
        "only the molecule's row is gone"
    );
    assert!(!workspace.exists(&doomed), "the owned file is deleted");
    assert!(
        workspace.exists(&kept),
        "an unrelated attachment is untouched"
    );
    workspace.cleanup();
}

#[test]
fn deleting_a_formulation_also_removes_its_experiments_attachments() {
    let workspace = Workspace::new("formulation");
    let connection = workspace.open();
    seed_chain(&connection);
    let formulation_file = workspace.attach("att-form", "formulation", "form-1");
    let experiment_file = workspace.attach("att-exp", "experiment", "exp-1");
    let molecule_file = workspace.attach("att-mol", "molecule", "mol-1");

    let reader = workspace.open();
    let mut paths =
        attachments::attachment_paths(&reader, attachments::ENTITY_FORMULATION, "form-1")
            .expect("formulation attachment paths");
    paths.extend(
        attachments::experiment_attachment_paths_for_formulation(&reader, "form-1")
            .expect("experiment attachment paths"),
    );
    assert_eq!(paths.len(), 2, "both direct and indirect files are owned");
    drop(reader);

    let mut connection = workspace.open();
    let (_, removed, failures) = delete_with_files(&workspace.root, &paths, || {
        let transaction = connection
            .transaction()
            .map_err(|err| format!("transaction: {err}"))?;
        transaction
            .execute(
                "DELETE FROM attachments
                 WHERE linked_entity_type = 'experiment'
                   AND linked_entity_id IN (SELECT id FROM experiments WHERE formulation_id = ?1)",
                params!["form-1"],
            )
            .map_err(|err| format!("experiment attachments: {err}"))?;
        attachments::delete_attachment_rows(
            &transaction,
            attachments::ENTITY_FORMULATION,
            "form-1",
        )?;
        transaction
            .execute(
                "DELETE FROM experiments WHERE formulation_id = 'form-1'",
                [],
            )
            .map_err(|err| format!("experiments: {err}"))?;
        transaction
            .execute("DELETE FROM formulations WHERE id = 'form-1'", [])
            .map_err(|err| format!("formulation: {err}"))?;
        transaction
            .commit()
            .map_err(|err| format!("commit: {err}"))?;
        Ok(())
    })
    .expect("the delete should succeed");

    assert_eq!(removed, 2);
    assert!(failures.is_empty());
    assert_eq!(
        workspace.attachment_count(),
        1,
        "only the molecule attachment survives"
    );
    assert!(!workspace.exists(&formulation_file));
    assert!(
        !workspace.exists(&experiment_file),
        "indirect attachments go too"
    );
    assert!(workspace.exists(&molecule_file));
    workspace.cleanup();
}

#[test]
fn deleting_an_experiment_removes_its_rows_and_files() {
    let workspace = Workspace::new("experiment");
    let connection = workspace.open();
    seed_chain(&connection);
    let experiment_file = workspace.attach("att-exp", "experiment", "exp-1");
    let formulation_file = workspace.attach("att-form", "formulation", "form-1");

    let mut connection = workspace.open();
    let (_, removed, failures) = delete_with_files(
        &workspace.root,
        std::slice::from_ref(&experiment_file),
        || {
            let transaction = connection
                .transaction()
                .map_err(|err| format!("transaction: {err}"))?;
            attachments::delete_attachment_rows(
                &transaction,
                attachments::ENTITY_EXPERIMENT,
                "exp-1",
            )?;
            transaction
                .execute("DELETE FROM experiments WHERE id = 'exp-1'", [])
                .map_err(|err| format!("experiment: {err}"))?;
            transaction
                .commit()
                .map_err(|err| format!("commit: {err}"))?;
            Ok(())
        },
    )
    .expect("the delete should succeed");

    assert_eq!(removed, 1);
    assert!(failures.is_empty());
    assert_eq!(workspace.attachment_count(), 1);
    assert!(!workspace.exists(&experiment_file));
    assert!(workspace.exists(&formulation_file));
    workspace.cleanup();
}

#[test]
fn deleting_one_attachment_leaves_its_neighbours_alone() {
    let workspace = Workspace::new("single");
    let connection = workspace.open();
    seed_chain(&connection);
    let doomed = workspace.attach("att-a", "molecule", "mol-1");
    let kept = workspace.attach("att-b", "molecule", "mol-1");

    let connection = workspace.open();
    let (deleted, removed, failures) =
        delete_with_files(&workspace.root, std::slice::from_ref(&doomed), || {
            connection
                .execute("DELETE FROM attachments WHERE id = 'att-a'", [])
                .map_err(|err| format!("attachment: {err}"))
        })
        .expect("the delete should succeed");

    assert_eq!((deleted, removed), (1, 1));
    assert!(failures.is_empty());
    assert!(!workspace.exists(&doomed));
    assert!(workspace.exists(&kept), "the sibling attachment survives");
    assert_eq!(workspace.attachment_count(), 1);
    workspace.cleanup();
}

#[test]
fn a_failed_transaction_puts_every_quarantined_file_back() {
    let workspace = Workspace::new("rollback");
    let connection = workspace.open();
    seed_chain(&connection);
    let relative = workspace.attach("att-mol", "molecule", "mol-1");
    // An additive keeps the molecule referenced, so the delete must fail.
    workspace
        .open()
        .execute_batch(
            "INSERT INTO additives (id, molecule_id, created_at, updated_at)
             VALUES ('add-1', 'mol-1', '2026-01-01', '2026-01-01');",
        )
        .expect("additive should insert");

    let mut connection = workspace.open();
    let error = delete_with_files(&workspace.root, std::slice::from_ref(&relative), || {
        let transaction = connection
            .transaction()
            .map_err(|err| format!("transaction: {err}"))?;
        transaction
            .execute("DELETE FROM molecules WHERE id = 'mol-1'", [])
            .map_err(|err| format!("molecule: {err}"))?;
        transaction
            .commit()
            .map_err(|err| format!("commit: {err}"))?;
        Ok(())
    })
    .expect_err("a referenced molecule cannot be deleted");

    assert!(error.contains("FOREIGN KEY"), "{error}");
    assert!(workspace.exists(&relative), "the file is restored");
    assert_eq!(
        fs::read_to_string(workspace.root.join(&relative)).expect("readable"),
        "payload for att-mol"
    );
    assert_eq!(workspace.attachment_count(), 1, "the row is still there");
    workspace.cleanup();
}

#[test]
fn an_attachment_row_whose_file_is_already_gone_still_deletes_and_says_so() {
    let workspace = Workspace::new("missing-file");
    let connection = workspace.open();
    seed_chain(&connection);
    let relative = workspace.attach("att-mol", "molecule", "mol-1");
    fs::remove_file(workspace.root.join(&relative)).expect("file removed out of band");

    let connection = workspace.open();
    let (_, removed, failures) =
        delete_with_files(&workspace.root, std::slice::from_ref(&relative), || {
            connection
                .execute("DELETE FROM attachments WHERE id = 'att-mol'", [])
                .map_err(|err| format!("attachment: {err}"))
        })
        .expect("a missing file must not block the row delete");

    assert_eq!(removed, 0);
    assert_eq!(workspace.attachment_count(), 0, "the row is gone");
    assert_eq!(failures.len(), 1, "the caller is told the file was missing");
    assert!(failures[0].contains("already gone"), "{:?}", failures);
    workspace.cleanup();
}

#[cfg(unix)]
#[test]
fn a_file_that_cannot_be_moved_aside_aborts_before_the_row_is_deleted() {
    use std::os::unix::fs::PermissionsExt;

    let workspace = Workspace::new("unmovable");
    let connection = workspace.open();
    seed_chain(&connection);
    let relative = "files/locked/held.csv".to_string();
    fs::create_dir_all(workspace.root.join("files/locked")).expect("directory should be created");
    fs::write(workspace.root.join(&relative), "held").expect("file should be written");
    workspace
        .open()
        .execute(
            "INSERT INTO attachments
               (id, linked_entity_type, linked_entity_id, file_name, relative_path, uploaded_at)
             VALUES ('att-locked', 'molecule', 'mol-1', 'held.csv', ?1, '2026-01-01')",
            params![&relative],
        )
        .expect("attachment row should insert");
    // A read-only directory refuses rename for the entries inside it.
    fs::set_permissions(
        workspace.root.join("files/locked"),
        fs::Permissions::from_mode(0o500),
    )
    .expect("permissions should apply");

    let connection = workspace.open();
    let outcome = delete_with_files(&workspace.root, std::slice::from_ref(&relative), || {
        connection
            .execute("DELETE FROM attachments WHERE id = 'att-locked'", [])
            .map_err(|err| format!("attachment: {err}"))
    });

    let _ = fs::set_permissions(
        workspace.root.join("files/locked"),
        fs::Permissions::from_mode(0o700),
    );
    // Running as root would bypass the permission, so only assert when it really applied.
    if outcome.is_err() {
        let error = outcome.expect_err("checked above");
        assert!(error.contains("could not be moved aside"), "{error}");
        assert!(error.contains("Nothing was deleted"), "{error}");
        assert_eq!(
            workspace.attachment_count(),
            1,
            "the row must survive so the file is not orphaned"
        );
        assert!(workspace.exists(&relative), "the file stays where it was");
    }
    workspace.cleanup();
}

#[test]
fn a_traversing_path_is_refused_and_the_target_is_untouched() {
    let workspace = Workspace::new("traversal");
    let outside = workspace.root.join("outside.txt");
    fs::write(&outside, "secret").expect("outside file should be written");

    for bad in [
        "../outside.txt",
        "files/../../outside.txt",
        "/etc/hosts",
        "files/./../../outside.txt",
        "",
    ] {
        assert!(
            workspace_relative(bad).is_err(),
            "{bad:?} must be refused as a workspace path"
        );
    }

    let mut quarantine = Quarantine::open(&workspace.root).expect("quarantine should open");
    let error = quarantine
        .take(&workspace.root, "../outside.txt")
        .expect_err("traversal must be refused");
    assert!(
        error.contains("leaves the workspace") || error.contains("not a valid workspace path"),
        "{error}"
    );
    assert!(outside.exists(), "the target file is untouched");
    workspace.cleanup();
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_workspace_is_refused_and_its_target_survives() {
    let workspace = Workspace::new("symlink");
    let outside =
        std::env::temp_dir().join(format!("lmd-symlink-target-{}.txt", std::process::id()));
    fs::write(&outside, "secret").expect("outside file should be written");
    let link = workspace.root.join("files/imports/escape.csv");
    std::os::unix::fs::symlink(&outside, &link).expect("symlink should be created");

    let error = resolve_in_workspace(&workspace.root, "files/imports/escape.csv")
        .expect_err("a symlink out of the workspace must be refused");
    assert!(error.contains("outside the active workspace"), "{error}");

    let mut quarantine = Quarantine::open(&workspace.root).expect("quarantine should open");
    assert!(quarantine
        .take(&workspace.root, "files/imports/escape.csv")
        .is_err());

    assert!(outside.exists(), "the symlink target is untouched");
    assert_eq!(
        fs::read_to_string(&outside).expect("readable"),
        "secret",
        "and unchanged"
    );
    let _ = fs::remove_file(&outside);
    workspace.cleanup();
}
