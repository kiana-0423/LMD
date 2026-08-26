//! Backups that are actually restorable.
//!
//! Copying `lmd.sqlite` with `fs::copy` is the obvious thing to do and it is wrong. The database
//! runs in WAL mode, so at any moment part of the committed state lives in `lmd.sqlite-wal` rather
//! than in the main file. A plain copy of the main file alone is a database missing its most
//! recent transactions — and it opens cleanly, so nothing announces the loss until somebody looks
//! for a record that is not there.
//!
//! SQLite's own backup API reads through the WAL and produces a consistent snapshot in one file.
//! Every backup here is taken that way, then reopened and integrity-checked before it is called a
//! backup at all.
//!
//! Restoring is staged for the same reason: the replacement is validated in a temporary location
//! and only then moved into place, so a corrupt or truncated archive can never become the live
//! workspace.

use crate::commands::errors::{self, coded};
use crate::db::migrations::data_quality_issues;
use crate::db::open_database;
use rusqlite::{backup::Backup, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// How many automatic backups a workspace keeps.
///
/// Bounded on purpose: an unbounded backup folder eventually fills the disk it is protecting.
pub const AUTOMATIC_BACKUP_LIMIT: usize = 10;

/// The prefix that marks a backup as one the application took by itself.
const AUTOMATIC_PREFIX: &str = "auto-";
const MANUAL_PREFIX: &str = "manual-";

/// One file in the workspace's `backups` folder.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    /// The timestamp encoded in the file name, which is what the list is ordered by.
    pub created_at: String,
    /// True when the application took it before a migration or on a schedule.
    pub automatic: bool,
}

/// What a verification of a database file found.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub ok: bool,
    /// SQLite's own answer: `ok`, or a list of what is wrong.
    pub integrity: String,
    /// How many dangling references `PRAGMA foreign_key_check` found.
    pub foreign_key_violations: i64,
    /// The schema version the file records.
    pub schema_version: i64,
    /// Legacy rows a current rule would reject, preserved rather than corrected.
    pub data_quality_issues: usize,
}

/// The `backups` folder of a workspace, created if it is not there yet.
pub fn backup_dir(workspace: &Path) -> Result<PathBuf, String> {
    let directory = workspace.join("backups");
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Failed to create the backups folder: {err}"))?;
    Ok(directory)
}

/// Runs SQLite's integrity checks against a database file.
///
/// `integrity_check` alone is not enough: a structurally sound file can still hold rows pointing at
/// records that are gone, and a restore that reinstates those is a restore of broken data.
pub fn verify_database(path: &Path) -> Result<IntegrityReport, String> {
    if !path.is_file() {
        return Err(coded(
            errors::DATABASE_INTEGRITY_FAILED,
            format!("No database at {}", path.display()),
        ));
    }
    let connection = open_database(path)
        .map_err(|err| format!("Failed to open {} for checking: {err}", path.display()))?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|err| format!("The integrity check did not run: {err}"))?;
    let foreign_key_violations: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|err| format!("The foreign key check did not run: {err}"))?;
    let schema_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|err| format!("The schema version could not be read: {err}"))?;
    let issues = data_quality_issues(&connection)?.len();

    Ok(IntegrityReport {
        ok: integrity == "ok" && foreign_key_violations == 0,
        integrity,
        foreign_key_violations,
        schema_version,
        data_quality_issues: issues,
    })
}

/// Takes a consistent snapshot of `source` at `destination` and verifies it.
///
/// Uses SQLite's online backup API rather than a file copy, so the WAL is read through and the
/// result is a complete database rather than a main file that has fallen behind its journal.
pub fn create_backup(source: &Path, destination: &Path) -> Result<IntegrityReport, String> {
    if !source.is_file() {
        return Err(coded(
            errors::BACKUP_FAILED,
            format!("There is no database to back up at {}", source.display()),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create the backup folder: {err}"))?;
    }
    // A leftover file from an interrupted run would otherwise be backed *into*.
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|err| format!("Failed to clear the previous backup file: {err}"))?;
    }

    let from = open_database(source).map_err(|err| {
        coded(
            errors::BACKUP_FAILED,
            format!("Failed to open the workspace database: {err}"),
        )
    })?;
    let mut to = Connection::open(destination).map_err(|err| {
        coded(
            errors::BACKUP_FAILED,
            format!("Failed to create the backup file: {err}"),
        )
    })?;
    {
        let backup = Backup::new(&from, &mut to).map_err(|err| {
            coded(
                errors::BACKUP_FAILED,
                format!("Failed to start the backup: {err}"),
            )
        })?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(|err| {
                coded(
                    errors::BACKUP_FAILED,
                    format!("The backup did not finish: {err}"),
                )
            })?;
    }
    drop(to);

    // A file that fails its own check is not a backup, and leaving it in the folder would let a
    // later restore pick it.
    let report = verify_database(destination).inspect_err(|_| {
        let _ = fs::remove_file(destination);
    })?;
    if !report.ok {
        let _ = fs::remove_file(destination);
        return Err(coded(
            errors::BACKUP_FAILED,
            format!(
                "The backup failed its integrity check ({}, {} foreign key violation(s)); it was discarded.",
                report.integrity, report.foreign_key_violations
            ),
        ));
    }
    Ok(report)
}

/// Names a backup after the moment it was taken, so the folder sorts chronologically.
pub fn backup_file_name(timestamp: &str, automatic: bool) -> String {
    let prefix = if automatic {
        AUTOMATIC_PREFIX
    } else {
        MANUAL_PREFIX
    };
    // `:` is illegal in a Windows filename and would make the whole feature platform-specific.
    let stamp = timestamp.replace([':', '.'], "-");
    format!("{prefix}{stamp}.sqlite")
}

/// Takes a backup before something that changes the database structure.
///
/// A migration is the one operation that can make a workspace unopenable by the build that wrote
/// it, so it is the operation that most needs a way back.
pub fn backup_before_migration(
    workspace: &Path,
    database: &Path,
    timestamp: &str,
) -> Result<PathBuf, String> {
    let directory = backup_dir(workspace)?;
    let destination = directory.join(backup_file_name(timestamp, true));
    create_backup(database, &destination)?;
    prune_automatic_backups(&directory, AUTOMATIC_BACKUP_LIMIT)?;
    Ok(destination)
}

/// Every backup in the folder, newest first.
pub fn list_backups(workspace: &Path) -> Result<Vec<BackupRecord>, String> {
    let directory = backup_dir(workspace)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|err| format!("Failed to read the backups folder: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read a backup entry: {err}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("sqlite") {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry
            .metadata()
            .map_err(|err| format!("Failed to read backup metadata: {err}"))?;
        let automatic = file_name.starts_with(AUTOMATIC_PREFIX);
        let created_at = file_name
            .trim_start_matches(AUTOMATIC_PREFIX)
            .trim_start_matches(MANUAL_PREFIX)
            .trim_end_matches(".sqlite")
            .to_string();
        records.push(BackupRecord {
            file_name,
            path: path.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
            created_at,
            automatic,
        });
    }
    // The names carry a sortable timestamp, so lexicographic order is chronological order.
    records.sort_by(|left, right| right.file_name.cmp(&left.file_name));
    Ok(records)
}

/// Keeps the newest `limit` automatic backups and removes the rest.
///
/// Manual backups are never pruned: a person asked for those, and deciding on their behalf that
/// one is no longer worth keeping is not the application's call.
pub fn prune_automatic_backups(directory: &Path, limit: usize) -> Result<Vec<String>, String> {
    let mut automatic: Vec<PathBuf> = fs::read_dir(directory)
        .map_err(|err| format!("Failed to read the backups folder: {err}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with(AUTOMATIC_PREFIX) && name.ends_with(".sqlite"))
        })
        .collect();
    automatic.sort();
    let mut removed = Vec::new();
    while automatic.len() > limit {
        let oldest = automatic.remove(0);
        let name = oldest.to_string_lossy().to_string();
        fs::remove_file(&oldest)
            .map_err(|err| format!("Failed to remove an expired backup: {err}"))?;
        removed.push(name);
    }
    Ok(removed)
}

/// What a restore did, and what it preserved on the way.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub restored_from: String,
    /// The backup taken of the database that was replaced, so the restore itself is reversible.
    pub previous_database_backup: String,
    pub report: IntegrityReport,
}

/// Replaces the live database with a backup, but only once the backup has proved itself.
///
/// The sequence matters and is the whole point:
///
///   1. Verify the candidate where it lies. A file that fails here is refused and nothing moves.
///   2. Copy it — again through SQLite's backup API — to a staging file beside the live database.
///   3. Verify the staged copy, because a copy can fail in ways the original did not.
///   4. Back up the database that is about to be replaced, so this operation is reversible too.
///   5. Only now replace the live file, and delete its stale `-wal`/`-shm` companions, which
///      belong to the database that is no longer there.
pub fn restore_backup(
    workspace: &Path,
    database: &Path,
    candidate: &Path,
    timestamp: &str,
) -> Result<RestoreOutcome, String> {
    let report = verify_database(candidate).map_err(|err| {
        coded(
            errors::RESTORE_REFUSED,
            format!("The selected file was not restored: {err}"),
        )
    })?;
    if !report.ok {
        return Err(coded(
            errors::RESTORE_REFUSED,
            format!(
                "The selected file failed its integrity check ({}); the current database was left untouched.",
                report.integrity
            ),
        ));
    }

    let staging = database.with_extension("restore-staging");
    let staged_report = create_backup(candidate, &staging).map_err(|err| {
        let _ = fs::remove_file(&staging);
        coded(
            errors::RESTORE_REFUSED,
            format!("The replacement could not be staged: {err}"),
        )
    })?;
    if !staged_report.ok {
        let _ = fs::remove_file(&staging);
        return Err(coded(
            errors::RESTORE_REFUSED,
            "The staged replacement failed its integrity check; the current database was left untouched.",
        ));
    }

    // The database about to be replaced is somebody's work until this instant.
    let previous = backup_dir(workspace)?.join(backup_file_name(
        &format!("{timestamp}-before-restore"),
        true,
    ));
    if database.is_file() {
        create_backup(database, &previous).map_err(|err| {
            let _ = fs::remove_file(&staging);
            coded(
                errors::RESTORE_REFUSED,
                format!(
                    "The current database could not be preserved, so nothing was replaced: {err}"
                ),
            )
        })?;
    }

    fs::rename(&staging, database).map_err(|err| {
        let _ = fs::remove_file(&staging);
        coded(
            errors::RESTORE_REFUSED,
            format!("The validated replacement could not be moved into place: {err}"),
        )
    })?;
    // These belong to the database that has just been replaced; leaving them would let SQLite
    // replay a journal against a file it was never written for.
    for suffix in ["-wal", "-shm"] {
        let companion = PathBuf::from(format!("{}{suffix}", database.display()));
        let _ = fs::remove_file(companion);
    }

    Ok(RestoreOutcome {
        restored_from: candidate.to_string_lossy().to_string(),
        previous_database_backup: previous.to_string_lossy().to_string(),
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::initialize_database_at;
    use uuid::Uuid;

    fn temp_workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!("lmd-backup-{}", Uuid::new_v4()));
        initialize_database_at(&root).expect("workspace should initialize");
        root
    }

    fn seed(workspace: &Path, name: &str) {
        let connection = open_database(workspace.join("lmd.sqlite")).expect("database should open");
        connection
            .execute(
                "INSERT INTO base_oils (id, name, created_at, updated_at)
                 VALUES (?1, ?2, '2026-01-01', '2026-01-01')",
                rusqlite::params![Uuid::new_v4().to_string(), name],
            )
            .expect("row should insert");
    }

    #[test]
    fn a_backup_captures_rows_that_are_still_only_in_the_write_ahead_log() {
        let workspace = temp_workspace();
        let database = workspace.join("lmd.sqlite");
        // Written and committed, but with no checkpoint: in WAL mode this row lives in the -wal
        // file, and a plain copy of lmd.sqlite would not contain it.
        seed(&workspace, "Only In The WAL");

        let destination = workspace.join("backups/test.sqlite");
        create_backup(&database, &destination).expect("backup should succeed");

        let restored = open_database(&destination).expect("backup should open");
        let found: i64 = restored
            .query_row(
                "SELECT COUNT(*) FROM base_oils WHERE name = 'Only In The WAL'",
                [],
                |row| row.get(0),
            )
            .expect("count should read");
        assert_eq!(
            found, 1,
            "a backup must contain committed but uncheckpointed rows"
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_backup_is_integrity_checked_before_it_is_called_a_backup() {
        let workspace = temp_workspace();
        let database = workspace.join("lmd.sqlite");
        seed(&workspace, "Real Oil");

        let destination = workspace.join("backups/checked.sqlite");
        let report = create_backup(&database, &destination).expect("backup should succeed");

        assert!(report.ok);
        assert_eq!(report.integrity, "ok");
        assert_eq!(report.foreign_key_violations, 0);
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_file_that_is_not_a_database_is_refused_and_nothing_is_replaced() {
        let workspace = temp_workspace();
        let database = workspace.join("lmd.sqlite");
        seed(&workspace, "Keep Me");
        let bogus = workspace.join("not-a-database.sqlite");
        fs::write(&bogus, b"this is not a SQLite file").expect("file should write");

        let error = restore_backup(&workspace, &database, &bogus, "2026-02-01T00-00-00Z")
            .expect_err("a corrupt candidate must be refused");
        assert!(error.contains("[restore.refused]"), "{error}");

        let connection = open_database(&database).expect("the live database still opens");
        let kept: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM base_oils WHERE name = 'Keep Me'",
                [],
                |row| row.get(0),
            )
            .expect("count should read");
        assert_eq!(kept, 1, "the live database must be untouched");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_restore_replaces_the_database_and_preserves_what_it_replaced() {
        let workspace = temp_workspace();
        let database = workspace.join("lmd.sqlite");
        seed(&workspace, "Original");

        let snapshot = workspace.join("backups/snapshot.sqlite");
        create_backup(&database, &snapshot).expect("snapshot should be taken");

        // Work done after the snapshot, which the restore will roll back — and which the restore's
        // own backup has to preserve.
        seed(&workspace, "Added After The Snapshot");

        let outcome = restore_backup(&workspace, &database, &snapshot, "2026-02-01T00-00-00Z")
            .expect("restore should succeed");

        let connection = open_database(&database).expect("the restored database opens");
        let (original, later): (i64, i64) = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM base_oils WHERE name = 'Original'),
                        (SELECT COUNT(*) FROM base_oils WHERE name = 'Added After The Snapshot')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("counts should read");
        assert_eq!(original, 1);
        assert_eq!(later, 0, "the snapshot predates that row");

        // The work the restore rolled back is still recoverable.
        let preserved = open_database(PathBuf::from(&outcome.previous_database_backup))
            .expect("the pre-restore backup opens");
        let recovered: i64 = preserved
            .query_row(
                "SELECT COUNT(*) FROM base_oils WHERE name = 'Added After The Snapshot'",
                [],
                |row| row.get(0),
            )
            .expect("count should read");
        assert_eq!(recovered, 1, "a restore must itself be reversible");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_restore_removes_the_journal_of_the_database_it_replaced() {
        let workspace = temp_workspace();
        let database = workspace.join("lmd.sqlite");
        seed(&workspace, "Original");
        let snapshot = workspace.join("backups/snapshot.sqlite");
        create_backup(&database, &snapshot).expect("snapshot should be taken");
        seed(&workspace, "Later");

        restore_backup(&workspace, &database, &snapshot, "2026-02-01T00-00-00Z")
            .expect("restore should succeed");

        let wal = PathBuf::from(format!("{}-wal", database.display()));
        assert!(
            !wal.exists(),
            "a journal belonging to the replaced database must not survive the restore"
        );
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn automatic_backups_are_bounded_and_manual_ones_are_never_pruned() {
        let workspace = temp_workspace();
        let directory = backup_dir(&workspace).expect("folder should exist");
        for index in 0..15 {
            fs::write(
                directory.join(format!("auto-2026-01-{index:02}.sqlite")),
                b"x",
            )
            .expect("file should write");
        }
        fs::write(directory.join("manual-2026-01-01.sqlite"), b"x").expect("file should write");

        let removed = prune_automatic_backups(&directory, AUTOMATIC_BACKUP_LIMIT)
            .expect("pruning should succeed");

        assert_eq!(removed.len(), 5);
        assert!(directory.join("manual-2026-01-01.sqlite").is_file());
        assert!(directory.join("auto-2026-01-14.sqlite").is_file());
        assert!(!directory.join("auto-2026-01-00.sqlite").exists());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_backup_name_is_usable_on_windows() {
        let name = backup_file_name("2026-02-01T12:30:45.123Z", true);
        assert!(
            !name.contains(':'),
            "a colon cannot appear in a Windows filename"
        );
        assert!(name.starts_with("auto-"));
        assert!(name.ends_with(".sqlite"));
    }
}
