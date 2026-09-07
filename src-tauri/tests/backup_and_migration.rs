//! Opening an older workspace must be survivable.
//!
//! A migration rewrites structure. If it goes wrong halfway — a full disk, a killed process, a bug
//! in a rule nobody anticipated — the user is left with a database their previous build can no
//! longer open and their new one cannot finish opening. The only defence that works is a verified
//! copy taken *before* the first structural statement runs.

use lubricant_materials_database::commands::backup::{list_backups, verify_database};
use lubricant_materials_database::db::migrations::initialize_database_at;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

fn temp_workspace(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("lmd-backup-mig-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    root
}

fn open(root: &Path) -> Connection {
    let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled");
    connection
}

/// Builds a workspace, then rewinds its recorded schema version so the next open migrates it.
fn workspace_needing_migration(name: &str) -> PathBuf {
    let root = temp_workspace(name);
    initialize_database_at(&root).expect("workspace should initialize");
    let connection = open(&root);
    connection
        .execute_batch(
            "INSERT INTO molecules (id, name, created_at, updated_at)
               VALUES ('m-1', 'Irreplaceable Molecule', '2026-01-01', '2026-01-01');
             INSERT INTO formulations (id, name, created_at, updated_at)
               VALUES ('f-1', 'Irreplaceable Blend', '2026-01-01', '2026-01-01');",
        )
        .expect("user data should insert");
    connection
        .pragma_update(None, "user_version", 2)
        .expect("version should rewind");
    drop(connection);
    root
}

#[test]
fn opening_a_workspace_that_needs_migrating_takes_a_verified_backup_first() {
    let root = workspace_needing_migration("pre-migration");

    initialize_database_at(&root).expect("the migration should run");

    let backups = list_backups(&root).expect("backups should list");
    assert_eq!(
        backups.len(),
        1,
        "exactly one automatic backup should have been taken"
    );
    assert!(backups[0].automatic);

    // It is a real database, and it holds the data that existed before the migration.
    let report = verify_database(Path::new(&backups[0].path)).expect("the backup should verify");
    assert!(
        report.ok,
        "a backup that fails its own check is not a backup"
    );
    let snapshot = Connection::open(&backups[0].path).expect("the backup should open");
    let name: String = snapshot
        .query_row("SELECT name FROM molecules WHERE id = 'm-1'", [], |row| {
            row.get(0)
        })
        .expect("the pre-migration row should be in the backup");
    assert_eq!(name, "Irreplaceable Molecule");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_workspace_already_at_the_current_version_is_not_backed_up_again() {
    let root = temp_workspace("no-op");
    initialize_database_at(&root).expect("workspace should initialize");
    let connection = open(&root);
    connection
        .execute_batch(
            "INSERT INTO molecules (id, name, created_at, updated_at)
             VALUES ('m-1', 'Already Current', '2026-01-01', '2026-01-01');",
        )
        .expect("user data should insert");
    drop(connection);

    initialize_database_at(&root).expect("reopening should be a no-op");
    initialize_database_at(&root).expect("and again");

    assert!(
        list_backups(&root).expect("backups should list").is_empty(),
        "reopening an up-to-date workspace must not fill the backups folder"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_empty_new_workspace_is_not_backed_up() {
    let root = temp_workspace("empty");
    initialize_database_at(&root).expect("workspace should initialize");
    let connection = open(&root);
    connection
        .pragma_update(None, "user_version", 0)
        .expect("version should rewind");
    drop(connection);

    initialize_database_at(&root).expect("the migration should run");

    assert!(
        list_backups(&root).expect("backups should list").is_empty(),
        "there is nothing to lose in an empty workspace"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn every_row_survives_the_migration_the_backup_was_taken_for() {
    let root = workspace_needing_migration("survives");

    initialize_database_at(&root).expect("the migration should run");

    let connection = open(&root);
    let (molecules, formulations): (i64, i64) = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM molecules), (SELECT COUNT(*) FROM formulations)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("counts should read");
    assert_eq!((molecules, formulations), (1, 1));

    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("version should read");
    assert_eq!(version, 8);
    drop(connection);
    let _ = std::fs::remove_dir_all(&root);
}
