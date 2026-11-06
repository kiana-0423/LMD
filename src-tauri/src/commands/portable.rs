//! Versioned, portable workspace archives: an SQLite snapshot plus every file under `files/`.
//! Import always creates a new workspace; neither the current workspace nor the input is changed.
use crate::app_paths::default_workspace_dir;
use crate::commands::backup::{create_backup, verify_database, IntegrityReport};
use crate::commands::errors::{self, coded};
use crate::db::migrations::{initialize_database_at, LATEST_SCHEMA_VERSION};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

type ArchiveResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const FORMAT: &str = "lmd-workspace";
const VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";
const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub source_platform: String,
    pub table_counts: BTreeMap<String, u64>,
    pub files: Vec<ArchiveFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreview {
    pub path: String,
    pub sha256: String,
    pub manifest: ArchiveManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImport {
    pub workspace_path: String,
    pub file_count: usize,
    pub report: IntegrityReport,
}

/// Enforce the same portable names on every OS, including Windows drive/UNC/ADS and device names.
fn portable_path(path: &str) -> ArchiveResult<()> {
    if path != "lmd.sqlite" && !path.starts_with("files/") {
        return Err(format!("Not a workspace data path: {path}").into());
    }
    for part in path.split('/') {
        let device = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|ch| ch.is_control() || "\\:<>\"|?*".contains(ch))
            || matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ["COM", "LPT"].iter().any(|prefix| {
                device.strip_prefix(prefix).is_some_and(|n| {
                    matches!(
                        n,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            })
        {
            return Err(
                format!("Path is not portable between Windows, macOS and Linux: {path}").into(),
            );
        }
    }
    Ok(())
}

fn register_path(path: &str, names: &mut BTreeMap<String, String>) -> ArchiveResult<()> {
    portable_path(path)?;
    let mut original = String::new();
    for part in path.split('/') {
        if !original.is_empty() {
            original.push('/');
        }
        original.push_str(part);
        let key = original.to_lowercase();
        if let Some(previous) = names.insert(key, original.clone()) {
            if previous != original {
                return Err(format!(
                    "Paths collide on a case-insensitive filesystem: {previous}, {original}"
                )
                .into());
            }
        }
    }
    Ok(())
}

fn table_counts(db: &Connection) -> ArchiveResult<BTreeMap<String, u64>> {
    let mut statement = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    names
        .into_iter()
        .map(|name| {
            let sql = format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\""));
            let count = db.query_row(&sql, [], |row| row.get(0))?;
            Ok((name, count))
        })
        .collect()
}

pub fn validate_lmd_database(path: &Path) -> Result<IntegrityReport, String> {
    let report = verify_database(path)?;
    if !report.ok || report.schema_version > LATEST_SCHEMA_VERSION || report.schema_version < 0 {
        return Err(coded(
            errors::RESTORE_REFUSED,
            "The database is damaged or requires a newer LMD version.",
        ));
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| err.to_string())?;
    for table in [
        "molecules",
        "base_oils",
        "additives",
        "formulations",
        "experiments",
        "settings",
    ] {
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        if !exists {
            return Err(coded(
                errors::RESTORE_REFUSED,
                format!("This is not an LMD database: missing {table}."),
            ));
        }
    }
    Ok(report)
}

const FILE_COLUMNS: &[(&str, &str)] = &[
    ("molecules", "structure_svg_path"),
    ("molecules", "mol_file_path"),
    ("molecules", "sdf_file_path"),
    ("molecules", "pdb_file_path"),
    ("attachments", "relative_path"),
    ("models", "relative_path"),
];

/// Old Windows paths are rewritten only in the snapshot, never in the source database.
fn file_references(db: &Connection, normalize: bool) -> ArchiveResult<BTreeSet<String>> {
    let mut references = BTreeSet::new();
    for (table, column) in FILE_COLUMNS {
        let mut query = db.prepare(&format!(
            "SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL AND {column} != ''"
        ))?;
        let values = query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(query);
        for value in values {
            let portable = value.replace('\\', "/");
            portable_path(&portable)?;
            if !portable.starts_with("files/") {
                return Err("A file reference cannot address the database.".into());
            }
            if normalize && portable != value {
                db.execute(
                    &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                    [&portable, &value],
                )?;
            } else if portable != value {
                return Err(format!("Non-portable stored file reference: {value}").into());
            }
            references.insert(portable);
        }
    }
    Ok(references)
}

fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, PathBuf>,
) -> ArchiveResult<()> {
    if !directory.exists() {
        return Ok(());
    }
    if fs::symlink_metadata(directory)?.file_type().is_symlink() {
        return Err("Workspace files must not contain symbolic links.".into());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(format!(
                "Symbolic link cannot be archived: {}",
                entry.path().display()
            )
            .into());
        }
        if kind.is_dir() {
            collect_files(root, &entry.path(), files)?;
        } else if kind.is_file() {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)?
                .components()
                .map(|part| part.as_os_str().to_str().ok_or("File name is not UTF-8"))
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            portable_path(&relative)?;
            files.insert(relative, path);
            if files.len() > MAX_FILES {
                return Err("Too many workspace files for one archive.".into());
            }
        } else {
            return Err("Only regular files can be archived.".into());
        }
    }
    Ok(())
}

fn copy_hash(
    reader: &mut impl Read,
    writer: &mut impl Write,
    limit: u64,
) -> ArchiveResult<(u64, String)> {
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        count = count
            .checked_add(read as u64)
            .ok_or("Archive size overflow")?;
        if count > limit {
            return Err("Archive exceeds its declared size or the 64 GiB limit.".into());
        }
        hash.update(&buffer[..read]);
        writer.write_all(&buffer[..read])?;
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

fn read_archive(path: &Path) -> ArchiveResult<(ZipArchive<File>, ArchivePreview)> {
    let mut file = File::open(path)?;
    let (_, hash) = copy_hash(
        &mut file,
        &mut std::io::sink(),
        MAX_BYTES + MAX_MANIFEST + 1024 * 1024 * 1024,
    )?;
    file.seek(SeekFrom::Start(0))?;
    let mut archive = ZipArchive::new(file)?;
    if archive.len() > MAX_FILES + 1 {
        return Err("Too many archive entries.".into());
    }
    let manifest: ArchiveManifest = {
        let entry = archive.by_name(MANIFEST)?;
        if entry.size() > MAX_MANIFEST {
            return Err("Archive manifest is too large.".into());
        }
        serde_json::from_reader(entry.take(MAX_MANIFEST + 1))?
    };
    if manifest.format != FORMAT || manifest.version != VERSION {
        return Err("This archive format requires a different LMD version.".into());
    }
    if !(0..=LATEST_SCHEMA_VERSION).contains(&manifest.schema_version) {
        return Err("This archive requires a newer LMD version.".into());
    }
    let mut names = BTreeMap::new();
    let mut expected = BTreeMap::new();
    let mut total = 0u64;
    for entry in &manifest.files {
        register_path(&entry.path, &mut names)?;
        if expected.insert(entry.path.as_str(), entry.size).is_some() {
            return Err("Duplicate file in manifest.".into());
        }
        if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Invalid SHA-256 in manifest.".into());
        }
        total = total
            .checked_add(entry.size)
            .ok_or("Archive size overflow")?;
        if total > MAX_BYTES {
            return Err("Archive exceeds the 64 GiB limit.".into());
        }
    }
    if !expected.contains_key("lmd.sqlite") || archive.len() != expected.len() + 1 {
        return Err("The archive is incomplete or has unlisted entries.".into());
    }
    let mut seen = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if !seen.insert(entry.name().to_owned())
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err("Duplicate or non-regular archive entry.".into());
        }
        if entry.name() != MANIFEST && expected.get(entry.name()) != Some(&entry.size()) {
            return Err(format!("Unexpected archive entry: {}", entry.name()).into());
        }
    }
    Ok((
        archive,
        ArchivePreview {
            path: path.to_string_lossy().into_owned(),
            sha256: hash,
            manifest,
        },
    ))
}

pub fn preview_archive(path: &Path) -> Result<ArchivePreview, String> {
    read_archive(path)
        .map(|(_, preview)| preview)
        .map_err(|err| coded(errors::RESTORE_REFUSED, err.to_string()))
}

pub fn export_archive(workspace: &Path, destination: &Path) -> Result<ArchivePreview, String> {
    export_inner(workspace, destination)
        .map_err(|err| coded(errors::BACKUP_FAILED, err.to_string()))
}

fn export_inner(workspace: &Path, destination: &Path) -> ArchiveResult<ArchivePreview> {
    let root = workspace.canonicalize()?;
    let parent = destination
        .parent()
        .ok_or("Choose an absolute destination path.")?
        .canonicalize()?;
    let destination = parent.join(destination.file_name().ok_or("Choose a file name.")?);
    // Never let a save dialog overwrite any live data, including aliases via symlinks.
    if destination.starts_with(&root) && !destination.starts_with(root.join("exports")) {
        return Err("Export outside the workspace or into its exports folder.".into());
    }
    if destination.exists() {
        let resolved = destination.canonicalize()?;
        if resolved.starts_with(&root) && !resolved.starts_with(root.join("exports")) {
            return Err("The export destination points to live workspace data.".into());
        }
    }
    let snapshot = tempfile::tempdir()?;
    let snapshot_db = snapshot.path().join("lmd.sqlite");
    // Keep database writers out while copying immutable, referenced files. Waiting background jobs
    // retain their original workspace; running jobs must finish before a complete export is possible.
    let live = crate::db::open_database(root.join("lmd.sqlite"))?;
    live.execute_batch("BEGIN IMMEDIATE")?;
    let active: i64 = live.query_row(
        "SELECT COUNT(*) FROM jobs WHERE status IN ('running', 'pending', 'queued')",
        [],
        |row| row.get(0),
    )?;
    if active != 0 {
        return Err("Wait for running or queued jobs to finish before exporting.".into());
    }
    create_backup(&root.join("lmd.sqlite"), &snapshot_db)?;
    let report = validate_lmd_database(&snapshot_db)?;
    let snapshot_conn = Connection::open(&snapshot_db)?;
    let references = file_references(&snapshot_conn, true)?;
    let counts = table_counts(&snapshot_conn)?;
    drop(snapshot_conn);
    let mut files = BTreeMap::from([("lmd.sqlite".to_owned(), snapshot_db)]);
    collect_files(&root, &root.join("files"), &mut files)?;
    for reference in references {
        if !files.contains_key(&reference) {
            return Err(format!("Referenced file is missing: {reference}").into());
        }
    }
    let output = tempfile::NamedTempFile::new_in(&parent)?;
    let mut archive = ZipWriter::new(output.reopen()?);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true)
        .unix_permissions(0o600);
    let mut manifest = ArchiveManifest {
        format: FORMAT.into(),
        version: VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        schema_version: report.schema_version,
        created_at: chrono::Utc::now().to_rfc3339(),
        source_platform: std::env::consts::OS.into(),
        table_counts: counts,
        files: Vec::new(),
    };
    let mut names = BTreeMap::new();
    let mut total = 0u64;
    for (relative, source) in files {
        register_path(&relative, &mut names)?;
        let mut input = File::open(&source)?;
        let before = input.metadata()?;
        archive.start_file(&relative, options)?;
        let (size, sha256) = copy_hash(&mut input, &mut archive, MAX_BYTES - total)?;
        let after = fs::metadata(&source)?;
        if size != before.len() || size != after.len() || before.modified()? != after.modified()? {
            return Err(format!("File changed during export; retry: {relative}").into());
        }
        total += size;
        manifest.files.push(ArchiveFile {
            path: relative,
            size,
            sha256,
        });
    }
    let json = serde_json::to_vec_pretty(&manifest)?;
    if json.len() as u64 > MAX_MANIFEST {
        return Err("Archive manifest is too large.".into());
    }
    archive.start_file(MANIFEST, options)?;
    archive.write_all(&json)?;
    archive.finish()?.sync_all()?;
    // Check the completed archive before replacing an existing destination.
    let (_, mut preview) = read_archive(output.path())?;
    output.persist(&destination)?;
    preview.path = destination.to_string_lossy().into_owned();
    Ok(preview)
}

pub fn import_archive(
    path: &Path,
    parent: &Path,
    expected_sha256: &str,
) -> Result<ArchiveImport, String> {
    import_inner(path, parent, expected_sha256)
        .map_err(|err| coded(errors::RESTORE_REFUSED, err.to_string()))
}

fn import_inner(path: &Path, parent: &Path, expected_sha256: &str) -> ArchiveResult<ArchiveImport> {
    let (mut archive, preview) = read_archive(path)?;
    if preview.sha256 != expected_sha256 {
        return Err("The archive changed after preview. Select it again.".into());
    }
    let parent = parent.canonicalize()?;
    let staging = tempfile::Builder::new()
        .prefix("LMD-Imported-")
        .tempdir_in(&parent)?;
    for entry in &preview.manifest.files {
        let destination = staging.path().join(&entry.path);
        fs::create_dir_all(destination.parent().ok_or("Missing file parent")?)?;
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        let mut input = archive.by_name(&entry.path)?;
        let (size, sha256) = copy_hash(&mut input, &mut output, entry.size)?;
        if size != entry.size || sha256 != entry.sha256 {
            return Err(format!("File checksum failed: {}", entry.path).into());
        }
        output.sync_all()?;
    }
    let database = staging.path().join("lmd.sqlite");
    let report = validate_lmd_database(&database)?;
    if report.schema_version != preview.manifest.schema_version {
        return Err("Database schema differs from the manifest.".into());
    }
    {
        let db = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        if table_counts(&db)? != preview.manifest.table_counts {
            return Err("Database table counts differ from the manifest.".into());
        }
        for reference in file_references(&db, false)? {
            if !staging.path().join(&reference).is_file() {
                return Err(format!("Referenced file is missing: {reference}").into());
            }
        }
    }
    initialize_database_at(staging.path())?;
    let report = verify_database(&database)?;
    if !report.ok {
        return Err("Imported database failed validation after migration.".into());
    }
    let workspace = staging.keep();
    Ok(ArchiveImport {
        workspace_path: workspace.to_string_lossy().into_owned(),
        file_count: preview.manifest.files.len(),
        report,
    })
}

#[tauri::command]
pub async fn export_workspace_archive(
    app: AppHandle,
    path: String,
) -> Result<ArchivePreview, String> {
    let workspace = default_workspace_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || export_archive(&workspace, Path::new(&path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn preview_workspace_archive(path: String) -> Result<ArchivePreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview_archive(Path::new(&path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn import_workspace_archive(
    path: String,
    parent: String,
    expected_sha256: String,
) -> Result<ArchiveImport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_archive(Path::new(&path), Path::new(&parent), &expected_sha256)
    })
    .await
    .map_err(|err| err.to_string())?
}
