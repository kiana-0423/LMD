//! Attachment lifecycle: safe path resolution and cascading deletion.
//!
//! Deleting a record must not leave its attachment rows behind, and must not leave their files
//! behind either. Both halves can fail independently, so deletion runs in three phases:
//!
//!   1. move every owned file into a workspace quarantine directory,
//!   2. commit the SQLite transaction,
//!   3. delete the quarantined files.
//!
//! A file that is present but cannot be moved aside in phase 1 aborts the whole delete before any
//! row is touched: removing the row anyway would leave a file on disk that nothing references. If
//! phase 2 fails, the quarantined files are moved back. A file that cannot be removed in phase 3 is
//! reported rather than silently ignored — the database is already consistent at that point, but
//! the caller deserves to know that disk cleanup was incomplete.

use crate::app_paths::default_workspace_dir;
use rusqlite::{params, Connection, Transaction};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

/// Entities that can own attachments.
pub const ENTITY_MOLECULE: &str = "molecule";
pub const ENTITY_FORMULATION: &str = "formulation";
pub const ENTITY_EXPERIMENT: &str = "experiment";

pub fn is_supported_entity(entity_type: &str) -> bool {
    matches!(
        entity_type,
        ENTITY_MOLECULE | ENTITY_FORMULATION | ENTITY_EXPERIMENT
    )
}

/// Rejects any stored path that would address something outside the workspace.
///
/// This runs on values read back from SQLite as well as on values supplied by a caller: a row
/// written by an older build, or edited by hand, must not be able to delete an arbitrary file.
pub fn workspace_relative(relative: &str) -> Result<PathBuf, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("A workspace path cannot be empty.".to_string());
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(format!(
            "'{relative}' is absolute; workspace files are addressed by relative path only."
        ));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(part) => {
                // A Windows-style path arriving on Unix would otherwise pass as one component.
                let text = part.to_string_lossy();
                if text.contains('\\') || text == ".." {
                    return Err(format!(
                        "'{relative}' contains a path component that leaves the workspace."
                    ));
                }
            }
            _ => {
                return Err(format!(
                    "'{relative}' is not a valid workspace path: it must stay inside the workspace."
                ))
            }
        }
    }
    Ok(candidate.to_path_buf())
}

/// Resolves a stored path against the workspace, refusing anything that escapes it — including
/// through a symlink, which the component check alone cannot catch.
pub fn resolve_in_workspace(workspace: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = workspace.join(workspace_relative(relative)?);
    let root = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    match path.canonicalize() {
        Ok(resolved) => {
            if !resolved.starts_with(&root) {
                return Err(format!(
                    "'{relative}' resolves outside the active workspace and was not touched."
                ));
            }
            Ok(resolved)
        }
        // The file may legitimately be missing; the parent still has to be inside the workspace.
        Err(_) => {
            if let Some(parent) = path.parent() {
                if let Ok(resolved_parent) = parent.canonicalize() {
                    if !resolved_parent.starts_with(&root) {
                        return Err(format!(
                            "'{relative}' resolves outside the active workspace and was not touched."
                        ));
                    }
                }
            }
            Ok(path)
        }
    }
}

/// A file moved aside while a transaction runs, so it can be restored or finally removed.
struct QuarantinedFile {
    original: PathBuf,
    quarantined: PathBuf,
    relative: String,
}

/// Holds files aside during a delete, restoring them if the database work fails.
pub struct Quarantine {
    directory: PathBuf,
    moved: Vec<QuarantinedFile>,
    /// Files the database referenced but that were already gone from disk.
    missing: Vec<String>,
}

impl Quarantine {
    pub fn open(workspace: &Path) -> Result<Self, String> {
        let directory = workspace.join(".trash").join(Uuid::new_v4().to_string());
        fs::create_dir_all(&directory)
            .map_err(|err| format!("Failed to create the workspace quarantine directory: {err}"))?;
        Ok(Self {
            directory,
            moved: Vec::new(),
            missing: Vec::new(),
        })
    }

    /// Moves one stored file aside.
    ///
    /// A file the database references but that is already gone is noted and tolerated — the row is
    /// what has to disappear. A file that is present and cannot be moved is an error: deleting its
    /// row anyway would leave a file on disk that nothing in the workspace knows about.
    pub fn take(&mut self, workspace: &Path, relative: &str) -> Result<(), String> {
        let original = resolve_in_workspace(workspace, relative)?;
        if !original.exists() {
            self.missing.push(relative.to_string());
            return Ok(());
        }
        let quarantined = self.directory.join(Uuid::new_v4().to_string());
        match fs::rename(&original, &quarantined) {
            Ok(()) => {
                self.moved.push(QuarantinedFile {
                    original,
                    quarantined,
                    relative: relative.to_string(),
                });
                Ok(())
            }
            Err(err) => Err(format!(
                "'{relative}' is present in the workspace but could not be moved aside ({err}), so its database record was left in place. Nothing was deleted."
            )),
        }
    }

    /// Paths the database referenced but that were already missing from disk.
    pub fn missing(&self) -> &[String] {
        &self.missing
    }

    /// Puts every quarantined file back, for when the database transaction failed.
    pub fn restore(self) -> Vec<String> {
        let mut failures = Vec::new();
        for file in &self.moved {
            if let Err(err) = fs::rename(&file.quarantined, &file.original) {
                failures.push(format!("{}: could not be restored ({err})", file.relative));
            }
        }
        if let Err(err) = fs::remove_dir_all(&self.directory) {
            failures.push(format!(
                "the quarantine directory could not be removed ({err})"
            ));
        }
        failures
    }

    /// Permanently removes the quarantined files after a successful commit.
    pub fn commit(self) -> Vec<String> {
        let mut failures = Vec::new();
        for file in &self.moved {
            if let Err(err) = fs::remove_file(&file.quarantined) {
                failures.push(format!("{}: could not be deleted ({err})", file.relative));
            }
        }
        if let Err(err) = fs::remove_dir_all(&self.directory) {
            failures.push(format!(
                "the quarantine directory could not be removed ({err})"
            ));
        }
        failures
    }

    pub fn moved_count(&self) -> usize {
        self.moved.len()
    }
}

/// Runs a delete in three phases: hold the files aside, commit the rows, then destroy the files.
///
/// Returns the number of files removed and the cleanup failures a caller must surface. A failure
/// to move a file aside aborts before any row is touched; a failure of the database work restores
/// every file it had moved.
pub fn delete_with_files<T>(
    workspace: &Path,
    paths: &[String],
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<(T, usize, Vec<String>), String> {
    let mut quarantine = Quarantine::open(workspace)?;
    for path in paths {
        // Propagates: an unmovable file must stop the delete before the row goes.
        if let Err(err) = quarantine.take(workspace, path) {
            let restore_failures = quarantine.restore();
            let mut message = err;
            if !restore_failures.is_empty() {
                message.push_str(&format!(
                    " Files already moved aside could not all be put back: {}",
                    restore_failures.join("; ")
                ));
            }
            return Err(message);
        }
    }

    let outcome = match commit() {
        Ok(outcome) => outcome,
        Err(err) => {
            let restore_failures = quarantine.restore();
            let mut message = err;
            if !restore_failures.is_empty() {
                message.push_str(&format!(
                    " Some files could not be put back: {}",
                    restore_failures.join("; ")
                ));
            }
            return Err(message);
        }
    };

    let removed = quarantine.moved_count();
    let mut failures: Vec<String> = quarantine
        .missing()
        .iter()
        .map(|relative| format!("{relative}: the record referenced a file that was already gone."))
        .collect();
    failures.extend(quarantine.commit());
    Ok((outcome, removed, failures))
}

/// Every attachment path owned by one entity.
pub fn attachment_paths(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT relative_path FROM attachments
             WHERE linked_entity_type = ?1 AND linked_entity_id = ?2
             ORDER BY id",
        )
        .map_err(|err| format!("Failed to prepare the attachment path query: {err}"))?;
    let paths = statement
        .query_map(params![entity_type, entity_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| format!("Failed to query attachment paths: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read an attachment path: {err}"));
    paths
}

/// Attachment paths for every experiment belonging to a formulation.
pub fn experiment_attachment_paths_for_formulation(
    connection: &Connection,
    formulation_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT a.relative_path
             FROM attachments a
             JOIN experiments e ON e.id = a.linked_entity_id
             WHERE a.linked_entity_type = 'experiment' AND e.formulation_id = ?1
             ORDER BY a.id",
        )
        .map_err(|err| format!("Failed to prepare the experiment attachment query: {err}"))?;
    let paths = statement
        .query_map(params![formulation_id], |row| row.get::<_, String>(0))
        .map_err(|err| format!("Failed to query experiment attachments: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read an experiment attachment path: {err}"));
    paths
}

/// Deletes the attachment rows owned by one entity inside an open transaction.
pub fn delete_attachment_rows(
    transaction: &Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
) -> Result<usize, String> {
    transaction
        .execute(
            "DELETE FROM attachments WHERE linked_entity_type = ?1 AND linked_entity_id = ?2",
            params![entity_type, entity_id],
        )
        .map_err(|err| format!("Failed to delete {entity_type} attachments: {err}"))
}

pub fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    default_workspace_dir(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lmd-attach-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("files/imports")).expect("workspace should be created");
        root
    }

    #[test]
    fn workspace_paths_reject_everything_that_leaves_the_workspace() {
        assert!(workspace_relative("files/imports/data.csv").is_ok());
        for bad in [
            "",
            "   ",
            "../outside.csv",
            "files/../../outside.csv",
            "/etc/passwd",
            "files/./../../secrets",
            "..",
            "files/imports/../../../etc/hosts",
        ] {
            assert!(
                workspace_relative(bad).is_err(),
                "{bad:?} must be rejected as a workspace path"
            );
        }
    }

    #[test]
    fn a_symlink_pointing_outside_the_workspace_is_refused() {
        let workspace = temp_workspace("symlink");
        let outside = std::env::temp_dir().join(format!("lmd-outside-{}.txt", std::process::id()));
        fs::write(&outside, "secret").expect("outside file should be written");
        let link = workspace.join("files/imports/escape.txt");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).expect("symlink should be created");
        #[cfg(not(unix))]
        {
            let _ = &link;
            return;
        }

        let error = resolve_in_workspace(&workspace, "files/imports/escape.txt")
            .expect_err("a symlink out of the workspace must be refused");
        assert!(error.contains("outside the active workspace"));
        // The target must still be there.
        assert!(outside.exists());

        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn quarantined_files_are_restored_when_the_transaction_fails() {
        let workspace = temp_workspace("restore");
        let relative = "files/imports/report.csv";
        fs::write(workspace.join(relative), "data").expect("file should be written");

        let mut quarantine = Quarantine::open(&workspace).expect("quarantine should open");
        quarantine
            .take(&workspace, relative)
            .expect("file should move aside");
        assert!(!workspace.join(relative).exists(), "the file is held aside");
        assert_eq!(quarantine.moved_count(), 1);

        let failures = quarantine.restore();

        assert!(failures.is_empty());
        assert!(workspace.join(relative).exists(), "the file comes back");
        assert_eq!(
            fs::read_to_string(workspace.join(relative)).expect("readable"),
            "data"
        );
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn committing_the_quarantine_removes_the_files_for_good() {
        let workspace = temp_workspace("commit");
        let relative = "files/imports/report.csv";
        fs::write(workspace.join(relative), "data").expect("file should be written");

        let mut quarantine = Quarantine::open(&workspace).expect("quarantine should open");
        quarantine
            .take(&workspace, relative)
            .expect("file should move aside");
        let failures = quarantine.commit();

        assert!(failures.is_empty());
        assert!(!workspace.join(relative).exists());
        assert!(!workspace.join(".trash").join("x").exists());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_missing_file_is_not_an_error_but_a_bad_path_is() {
        let workspace = temp_workspace("missing");
        let mut quarantine = Quarantine::open(&workspace).expect("quarantine should open");

        quarantine
            .take(&workspace, "files/imports/never-existed.csv")
            .expect("a missing file is tolerated");
        assert_eq!(quarantine.moved_count(), 0);

        let error = quarantine
            .take(&workspace, "../escape.csv")
            .expect_err("a traversing path must be refused");
        assert!(
            error.contains("leaves the workspace") || error.contains("not a valid workspace path")
        );
        let _ = fs::remove_dir_all(&workspace);
    }
}
