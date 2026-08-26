//! Generated 3D structures against a real database file and a real workspace directory.
//!
//! What matters here is not that a file was written, but that the workspace still describes the
//! same structure after the process that wrote it is gone — and that a failed regeneration leaves
//! the previous structure exactly as it was.

use lubricant_materials_database::commands::molecule_visualization::{
    publish_structure, stored_structure_paths,
};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

/// A three-atom V2000 block with real coordinates, of the shape RDKit emits.
fn molblock(marker: &str) -> String {
    format!(
        "\n  RDKit          3D  {marker}\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.5000    0.0000    0.0000 C   0  0\n    2.0000    1.2000    0.0000 O   0  0\n  1  2  1  0\n  2  3  1  0\nM  END\n"
    )
}

fn pdb(marker: &str) -> String {
    format!(
        "HEADER    {marker}\nATOM      1  C   UNL     1       0.000   0.000   0.000\nHETATM    2  O   UNL     1       1.500   0.000   0.000\nEND\n"
    )
}

fn blocks(marker: &str) -> Vec<(&'static str, &'static str, String, usize)> {
    vec![
        ("mol", "mol", molblock(marker), 3),
        ("sdf", "sdf", molblock(marker), 3),
        ("pdb", "pdb", pdb(marker), 2),
    ]
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "lmd-structure-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("files/structures")).expect("workspace should be created");
        let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
        connection
            .execute_batch(schema())
            .expect("schema should initialize");
        connection
            .execute_batch(
                "INSERT INTO molecules (id, name, smiles_canonical, created_at, updated_at)
                 VALUES ('mol-1', 'Ethanol', 'CCO', '2026-01-01', '2026-01-01');",
            )
            .expect("molecule should insert");
        Self { root }
    }

    /// A brand new connection, as a restarted application would open.
    fn reopen(&self) -> Connection {
        Connection::open(self.root.join("lmd.sqlite")).expect("database should open")
    }

    fn stored_paths(&self) -> (String, String, String) {
        self.reopen()
            .query_row(
                "SELECT COALESCE(mol_file_path, ''), COALESCE(sdf_file_path, ''),
                        COALESCE(pdb_file_path, '')
                 FROM molecules WHERE id = 'mol-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("paths should read")
    }

    fn read(&self, relative: &str) -> String {
        fs::read_to_string(self.root.join(relative)).expect("structure file should be readable")
    }

    fn structure_files(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.root.join("files/structures"))
            .expect("structure directory should exist")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    fn cleanup(&self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn a_generated_structure_survives_a_restart_with_its_paths_and_contents() {
    let workspace = Workspace::new("restart");

    let published = {
        // A connection that is dropped before the assertions, as the generating process would be.
        let connection = workspace.reopen();
        let previous = stored_structure_paths(&connection, "mol-1").expect("nothing stored yet");
        publish_structure(
            &connection,
            &workspace.root,
            "mol-1",
            "v1",
            &blocks("first"),
            previous,
        )
        .expect("the structure should publish")
    };

    assert!(published.cleanup_failures.is_empty());
    assert_eq!(
        published.replaced, 0,
        "nothing was superseded on the first run"
    );

    // Reopened from scratch: what the database says, and what is on disk, must still agree.
    let (mol, sdf, pdb_path) = workspace.stored_paths();
    assert_eq!(mol, published.mol_path);
    assert_eq!(sdf, published.sdf_path);
    assert_eq!(pdb_path, published.pdb_path);
    assert!(mol.ends_with(".mol") && sdf.ends_with(".sdf") && pdb_path.ends_with(".pdb"));

    assert!(workspace.read(&mol).contains("first"));
    assert!(workspace.read(&mol).contains("V2000"));
    assert!(workspace.read(&sdf).contains("first"));
    assert!(workspace.read(&pdb_path).contains("HETATM"));
    workspace.cleanup();
}

#[test]
fn regenerating_replaces_the_previous_version_and_removes_its_files() {
    let workspace = Workspace::new("replace");
    let connection = workspace.reopen();
    let first = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("nothing stored yet"),
    )
    .expect("first publish");

    let second = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v2",
        &blocks("second"),
        stored_structure_paths(&connection, "mol-1").expect("the first version is stored"),
    )
    .expect("second publish");

    assert_ne!(
        first.mol_path, second.mol_path,
        "each version has its own path"
    );
    assert_eq!(second.replaced, 3, "all three superseded files are removed");
    assert!(second.cleanup_failures.is_empty());
    assert_eq!(workspace.stored_paths().0, second.mol_path);
    assert!(workspace.read(&second.mol_path).contains("second"));
    assert_eq!(
        workspace.structure_files().len(),
        3,
        "the old version does not accumulate: {:?}",
        workspace.structure_files()
    );
    workspace.cleanup();
}

#[test]
fn a_failed_publish_leaves_the_previous_structure_untouched() {
    let workspace = Workspace::new("rollback");
    let connection = workspace.reopen();
    let first = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("nothing stored yet"),
    )
    .expect("first publish");
    let before = workspace.structure_files();

    // The molecule disappears after its paths are read and before the update lands, which is
    // exactly the race the row-count check guards. Every file the attempt wrote must go, and the
    // first version must remain byte-for-byte.
    let previous = stored_structure_paths(&connection, "mol-1").expect("the first version");
    connection
        .execute("DELETE FROM molecules WHERE id = 'mol-1'", [])
        .expect("molecule should delete");
    let error = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v2",
        &blocks("second"),
        previous,
    )
    .expect_err("an update that matches no row must fail");

    assert!(error.contains("no longer exists"), "{error}");
    assert_eq!(
        workspace.structure_files(),
        before,
        "the failed attempt left nothing behind"
    );
    assert!(
        workspace.read(&first.mol_path).contains("first"),
        "the previous structure is byte-for-byte intact"
    );
    workspace.cleanup();
}

#[test]
fn a_blank_generation_is_refused_before_anything_is_written() {
    let workspace = Workspace::new("empty");
    let connection = workspace.reopen();

    let error = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &[("mol", "mol", String::new(), 0)],
        stored_structure_paths(&connection, "mol-1").expect("nothing stored yet"),
    )
    .expect_err("a structure with no atoms must not be stored");

    assert!(
        error.contains("no structure with readable coordinates"),
        "{error}"
    );
    assert_eq!(workspace.stored_paths().0, "", "nothing was recorded");
    assert!(workspace.structure_files().is_empty());
    workspace.cleanup();
}

#[test]
fn publishing_for_a_molecule_that_does_not_exist_writes_nothing() {
    let workspace = Workspace::new("absent");
    let connection = workspace.reopen();

    let error = stored_structure_paths(&connection, "mol-absent")
        .expect_err("an unknown molecule must be refused before anything is written");

    assert!(error.contains("Molecule not found"), "{error}");
    assert!(workspace.structure_files().is_empty());
    workspace.cleanup();
}

// --- cleanup reporting ---------------------------------------------------------------------------

#[test]
fn a_superseded_path_that_cannot_be_resolved_is_reported_rather_than_ignored() {
    let workspace = Workspace::new("bad-path");
    let connection = workspace.reopen();
    // A row written by something other than this build: an absolute path, and a traversal.
    connection
        .execute(
            "UPDATE molecules SET mol_file_path = '/etc/hosts',
                                  sdf_file_path = '../outside.sdf'
             WHERE id = 'mol-1'",
            [],
        )
        .expect("paths should update");
    let outside = workspace.root.join("../outside.sdf");
    let _ = fs::write(&outside, "must survive");

    let published = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("publishing still succeeds; only the cleanup is incomplete");

    assert_eq!(
        published.replaced, 0,
        "nothing outside the workspace is removed"
    );
    assert_eq!(
        published.cleanup_failures.len(),
        2,
        "{:?}",
        published.cleanup_failures
    );
    assert!(published
        .cleanup_failures
        .iter()
        .any(|failure| failure.contains("/etc/hosts")));
    assert!(published
        .cleanup_failures
        .iter()
        .any(|failure| failure.contains("outside.sdf")));
    // The refusal is the point: neither file is touched.
    assert!(std::path::Path::new("/etc/hosts").exists());
    assert!(outside.exists());
    let _ = fs::remove_file(&outside);
    workspace.cleanup();
}

#[cfg(unix)]
#[test]
fn a_superseded_symlink_that_leaves_the_workspace_is_reported_and_its_target_survives() {
    let workspace = Workspace::new("bad-symlink");
    let outside =
        std::env::temp_dir().join(format!("lmd-structure-target-{}.mol", std::process::id()));
    fs::write(&outside, "a file the workspace must not delete").expect("target should be written");
    let link = workspace.root.join("files/structures/escape.mol");
    std::os::unix::fs::symlink(&outside, &link).expect("symlink should be created");
    let connection = workspace.reopen();
    connection
        .execute(
            "UPDATE molecules SET mol_file_path = 'files/structures/escape.mol' WHERE id = 'mol-1'",
            [],
        )
        .expect("path should update");

    let published = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("publishing succeeds");

    assert_eq!(published.replaced, 0);
    assert!(published
        .cleanup_failures
        .iter()
        .any(|failure| failure.contains("escape.mol") && failure.contains("outside")));
    assert!(outside.exists(), "the symlink target is untouched");
    assert_eq!(
        fs::read_to_string(&outside).expect("readable"),
        "a file the workspace must not delete"
    );
    let _ = fs::remove_file(&outside);
    workspace.cleanup();
}

#[test]
fn a_superseded_file_that_is_already_gone_is_reported_and_not_counted_as_replaced() {
    let workspace = Workspace::new("already-gone");
    let connection = workspace.reopen();
    let first = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("first publish");
    // Something removed one of the files behind the application's back.
    fs::remove_file(workspace.root.join(&first.mol_path)).expect("file removed out of band");

    let second = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v2",
        &blocks("second"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("second publish");

    // Two files really were removed; the third could not be, and says so.
    assert_eq!(second.replaced, 2);
    assert_eq!(second.cleanup_failures.len(), 1);
    assert!(
        second.cleanup_failures[0].contains("already gone"),
        "{:?}",
        second.cleanup_failures
    );
    workspace.cleanup();
}

#[cfg(unix)]
#[test]
fn a_superseded_file_the_filesystem_refuses_to_delete_is_reported() {
    use std::os::unix::fs::PermissionsExt;

    let workspace = Workspace::new("locked");
    let connection = workspace.reopen();
    let locked = workspace.root.join("files/structures/locked");
    fs::create_dir_all(&locked).expect("directory should be created");
    fs::write(locked.join("held.mol"), "held").expect("file should be written");
    connection
        .execute(
            "UPDATE molecules SET mol_file_path = 'files/structures/locked/held.mol'
             WHERE id = 'mol-1'",
            [],
        )
        .expect("path should update");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).expect("permissions apply");

    let published = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("publishing succeeds even when the old file cannot go");

    let can_delete = fs::remove_file(locked.join("held.mol")).is_ok();
    let _ = fs::set_permissions(&locked, fs::Permissions::from_mode(0o700));
    // Running as root bypasses the permission, so only assert when it actually applied.
    if !can_delete {
        assert_eq!(published.replaced, 0);
        assert!(published
            .cleanup_failures
            .iter()
            .any(|failure| failure.contains("held.mol")));
    }
    workspace.cleanup();
}

#[test]
fn replaced_counts_only_the_files_that_are_really_gone() {
    let workspace = Workspace::new("replaced-count");
    let connection = workspace.reopen();
    publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v1",
        &blocks("first"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("first publish");

    let second = publish_structure(
        &connection,
        &workspace.root,
        "mol-1",
        "v2",
        &blocks("second"),
        stored_structure_paths(&connection, "mol-1").expect("paths read"),
    )
    .expect("second publish");

    assert_eq!(second.replaced, 3);
    assert!(second.cleanup_failures.is_empty());
    assert_eq!(
        workspace.structure_files().len(),
        3,
        "and the workspace really does hold only the new version"
    );
    workspace.cleanup();
}
