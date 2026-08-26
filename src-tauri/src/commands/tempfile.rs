//! Ownership for files that are only real once something else succeeds.
//!
//! A staged dataset, a half-written model, or a freshly generated structure is not yet referenced
//! by the database. If the operation fails, the file has to go — and if it cannot go, that has to
//! be said. `let _ = fs::remove_file(...)` does neither: it leaves the workspace growing files
//! nothing points at, and reports success while doing so.
//!
//! [`TempFile`] claims a path, removes it when discarded, and hands the caller any failure to do
//! so. [`TempFile::keep`] releases the claim once the file has become permanent.

use std::fs;
use std::path::{Path, PathBuf};

/// A file that is temporary until something says otherwise.
#[derive(Debug)]
pub struct TempFile {
    path: PathBuf,
    /// False once the file has become permanent, or has already been removed.
    owned: bool,
}

impl TempFile {
    /// Claims a path. The file need not exist yet.
    pub fn claim(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            owned: true,
        }
    }

    /// Releases the claim: the file is now referenced by something durable.
    pub fn keep(&mut self) {
        self.owned = false;
    }

    /// Removes the file now, returning a description of any failure.
    ///
    /// A file that was never written is not a failure; a file that exists and cannot be removed is.
    pub fn discard(mut self) -> Vec<String> {
        let failures = self.remove_now();
        self.owned = false;
        failures
    }

    fn remove_now(&self) -> Vec<String> {
        if !self.owned || !self.path.exists() {
            return Vec::new();
        }
        match fs::remove_file(&self.path) {
            Ok(()) => Vec::new(),
            Err(err) => vec![format!("{}: {err}", self.path.display())],
        }
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        // Reached on a panic or an early return that forgot to discard. The message goes to the
        // log rather than nowhere, so an undeletable file is still visible.
        for failure in self.remove_now() {
            eprintln!("LMD: a temporary file could not be removed: {failure}");
        }
    }
}

/// Removes a set of files, collecting every failure instead of stopping at the first.
pub fn remove_all(paths: &[PathBuf]) -> Vec<String> {
    let mut failures = Vec::new();
    for path in paths {
        if !path.exists() {
            continue;
        }
        if let Err(err) = fs::remove_file(path) {
            failures.push(format!("{}: {err}", path.display()));
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "lmd-tempfile-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("scratch directory should be created");
        directory
    }

    #[test]
    fn discarding_removes_the_file_and_reports_nothing() {
        let directory = scratch("discard");
        let path = directory.join("staged.json");
        fs::write(&path, "{}").expect("file should be written");

        let failures = TempFile::claim(&path).discard();

        assert!(failures.is_empty());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_kept_file_survives_both_discard_and_drop() {
        let directory = scratch("keep");
        let path = directory.join("model.joblib");
        fs::write(&path, "model").expect("file should be written");

        {
            let mut file = TempFile::claim(&path);
            file.keep();
            assert!(file.discard().is_empty());
        }

        assert!(path.exists(), "a kept file is no longer temporary");
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn dropping_without_discarding_still_removes_the_file() {
        let directory = scratch("drop");
        let path = directory.join("orphan.json");
        fs::write(&path, "{}").expect("file should be written");

        drop(TempFile::claim(&path));

        assert!(!path.exists(), "an early return must not leave an orphan");
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_file_that_was_never_written_is_not_a_failure() {
        let directory = scratch("absent");
        let failures = TempFile::claim(directory.join("never-written.json")).discard();
        assert!(failures.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn removing_a_set_reports_every_path_that_could_not_go() {
        let directory = scratch("set");
        let present = directory.join("a.txt");
        fs::write(&present, "a").expect("file should be written");
        let absent = directory.join("b.txt");

        let failures = remove_all(&[present.clone(), absent]);

        assert!(failures.is_empty());
        assert!(!present.exists());
        let _ = fs::remove_dir_all(&directory);
    }

    #[cfg(unix)]
    #[test]
    fn an_undeletable_file_is_reported_rather_than_ignored() {
        use std::os::unix::fs::PermissionsExt;
        let directory = scratch("locked");
        let inner = directory.join("locked");
        fs::create_dir_all(&inner).expect("directory should be created");
        let path = inner.join("held.txt");
        fs::write(&path, "held").expect("file should be written");
        // A read-only directory refuses unlink for its entries.
        fs::set_permissions(&inner, fs::Permissions::from_mode(0o500))
            .expect("permissions should apply");

        let failures = TempFile::claim(&path).discard();

        // Running as root would bypass the permission entirely, so only assert when it applied.
        if fs::remove_file(&path).is_err() {
            assert_eq!(failures.len(), 1, "the failure must be reported");
            assert!(failures[0].contains("held.txt"));
        }
        let _ = fs::set_permissions(&inner, fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(&directory);
    }
}
