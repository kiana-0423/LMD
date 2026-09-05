use crate::app_paths::default_workspace_dir;
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use crate::commands::tempfile::TempFile;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Extensions the export command will write, matched to the sidecar's output formats.
const EXPORT_FORMATS: &[(&str, &str)] = &[
    ("smiles", "smi"),
    ("mol", "mol"),
    ("sdf", "sdf"),
    ("pdb", "pdb"),
    ("inchi", "inchi"),
    ("inchikey", "txt"),
    ("svg", "svg"),
];

/// Counts atom lines in a MOL/SDF block, so an unparseable block is not stored as a structure.
fn molblock_atom_count(block: &str) -> usize {
    let lines: Vec<&str> = block.lines().collect();
    // The counts line is the fourth line of a V2000 block: "aaabbb...".
    let Some(counts) = lines.get(3) else {
        return 0;
    };
    let declared: usize = counts
        .get(0..3)
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    if declared == 0 {
        return 0;
    }
    // Confirm the declared atoms are actually present with three coordinates each.
    lines
        .iter()
        .skip(4)
        .take(declared)
        .filter(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts.len() >= 4 && parts[0..3].iter().all(|part| part.parse::<f64>().is_ok())
        })
        .count()
}

fn pdb_atom_count(block: &str) -> usize {
    block
        .lines()
        .filter(|line| line.starts_with("ATOM") || line.starts_with("HETATM"))
        .count()
}

/// Generates 3D coordinates with the packaged RDKit sidecar and stores them in the workspace.
///
/// The molecule is loaded from SQLite rather than trusting a SMILES string from the frontend, and
/// the returned blocks are checked for real atoms before anything is written.
///
/// Publishing is atomic in the only place it can be: each new file is written to its own versioned
/// path, so it never overwrites the structure already on disk, and a single `UPDATE` switches the
/// molecule to the new paths. Until that statement commits, the previously stored structure is
/// untouched and the new files are owned by guards that remove them on any failure. Once it
/// commits, the superseded files are deleted and any that could not be removed are reported.
#[tauri::command]
pub async fn generate_molecule_3d(app: AppHandle, molecule_id: String) -> Result<Value, String> {
    let workspace = default_workspace_dir(&app)?;
    let connection = crate::db::open_database(crate::app_paths::default_database_path(&app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))?;

    let stored: Option<Option<String>> = connection
        .query_row(
            "SELECT COALESCE(NULLIF(smiles_canonical, ''), smiles_raw)
             FROM molecules WHERE id = ?1",
            rusqlite::params![&molecule_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to load molecule {molecule_id}: {err}"))?;
    let Some(smiles) = stored else {
        return Err(format!("Molecule not found: {molecule_id}"));
    };
    let smiles = smiles.unwrap_or_default().trim().to_string();
    if smiles.is_empty() {
        return Err(format!(
            "Molecule {molecule_id} has no SMILES, so 3D coordinates cannot be computed."
        ));
    }

    let response = run_sidecar_command(
        &app,
        "generate-3d",
        json!({
            "smiles": smiles,
            "add_hydrogens": true,
            "optimize": true,
            "force_field": "MMFF"
        }),
    )
    .await?;
    let data = response
        .get("data")
        .ok_or_else(|| "The sidecar returned no 3D structure.".to_string())?;
    let read = |key: &str| {
        data.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let mol_block = read("mol_block");
    let sdf_block = read("sdf_block");
    let pdb_block = read("pdb_block");

    // A block with no readable coordinates is a failure, not a structure worth storing.
    let mol_atoms = molblock_atom_count(&mol_block);
    let sdf_atoms = molblock_atom_count(&sdf_block);
    let pdb_atoms = pdb_atom_count(&pdb_block);
    if mol_atoms == 0 && sdf_atoms == 0 && pdb_atoms == 0 {
        return Err(
            "3D generation returned a structure with no readable atom coordinates; nothing was saved."
                .to_string(),
        );
    }

    // A version stamp unique to this generation, so a new structure can never overwrite the one
    // the database still points at.
    let version = uuid::Uuid::new_v4().to_string();
    let previous = stored_structure_paths(&connection, &molecule_id)?;
    let published = publish_structure(
        &connection,
        &workspace,
        &molecule_id,
        &version,
        &[
            ("mol", "mol", mol_block, mol_atoms),
            ("sdf", "sdf", sdf_block, sdf_atoms),
            ("pdb", "pdb", pdb_block, pdb_atoms),
        ],
        previous,
    )?;

    let molecule = crate::commands::molecule::get_molecule(app, molecule_id.clone())?
        .ok_or_else(|| format!("Molecule not found after generation: {molecule_id}"))?;
    ok(
        "generate_molecule_3d",
        json!({
            "molecule": molecule,
            "molFilePath": published.mol_path,
            "sdfFilePath": published.sdf_path,
            "pdbFilePath": published.pdb_path,
            "atomCount": mol_atoms.max(sdf_atoms).max(pdb_atoms),
            "replacedVersions": published.replaced,
            "cleanupFailures": published.cleanup_failures,
            "mode": "real"
        }),
    )
}

/// Where a published structure landed, and what could not be tidied up afterwards.
#[derive(Debug, Default)]
pub struct PublishedStructure {
    pub mol_path: String,
    pub sdf_path: String,
    pub pdb_path: String,
    /// How many superseded files were actually removed — not how many removals were attempted.
    pub replaced: usize,
    /// Every superseded file that is still on disk, and why: a path that could not be resolved
    /// safely, one that was already gone, or one the filesystem refused to delete. The database is
    /// already correct in all three cases, which is exactly why they have to be said out loud.
    pub cleanup_failures: Vec<String>,
}

/// Stages structure files at versioned paths and publishes them with a single `UPDATE`.
///
/// Nothing overwrites the structure already on disk: each block is written to a path carrying this
/// generation's version stamp. Until the `UPDATE` commits, the new files are owned by guards that
/// remove them on any failure, so a failed publish leaves the previously stored structure exactly
/// as it was. Once it commits, the superseded files are removed and any that could not be are
/// returned rather than ignored.
///
/// `blocks` is `(kind, extension, content, atom_count)`; a block with no atoms is skipped.
/// The structure paths a molecule currently points at.
///
/// Read before a regeneration so the superseded files can be identified afterwards. Kept separate
/// from [`publish_structure`] so a test can reproduce the race the publish guards against: the
/// molecule being deleted between this read and the update.
pub fn stored_structure_paths(
    connection: &rusqlite::Connection,
    molecule_id: &str,
) -> Result<(String, String, String), String> {
    let previous: Option<(Option<String>, Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT mol_file_path, sdf_file_path, pdb_file_path FROM molecules WHERE id = ?1",
            rusqlite::params![molecule_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|err| format!("Failed to read the stored structure for {molecule_id}: {err}"))?;
    let Some((mol, sdf, pdb)) = previous else {
        return Err(format!("Molecule not found: {molecule_id}"));
    };
    Ok((
        mol.unwrap_or_default(),
        sdf.unwrap_or_default(),
        pdb.unwrap_or_default(),
    ))
}

pub fn publish_structure(
    connection: &rusqlite::Connection,
    workspace: &Path,
    molecule_id: &str,
    version: &str,
    blocks: &[(&str, &str, String, usize)],
    previous: (String, String, String),
) -> Result<PublishedStructure, String> {
    let (previous_mol, previous_sdf, previous_pdb) = previous;

    let mut staged: Vec<TempFile> = Vec::new();
    let mut published = PublishedStructure::default();
    for (kind, extension, block, atoms) in blocks {
        if *atoms == 0 {
            continue;
        }
        let relative = format!("files/structures/{molecule_id}-{version}.{extension}");
        let absolute = crate::commands::attachments::resolve_in_workspace(workspace, &relative)?;
        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create the structure directory: {err}"))?;
        }
        // Claimed before the write, so a failure part-way through still removes what landed.
        staged.push(TempFile::claim(&absolute));
        if let Err(err) = fs::write(&absolute, block) {
            // Dropping the guards removes every file this generation had written.
            return Err(format!("Failed to write the {kind} structure file: {err}"));
        }
        match *kind {
            "mol" => published.mol_path = relative,
            "sdf" => published.sdf_path = relative,
            _ => published.pdb_path = relative,
        }
    }
    if staged.is_empty() {
        return Err(
            "3D generation produced no structure with readable coordinates; nothing was saved."
                .to_string(),
        );
    }

    let now = chrono::Utc::now().to_rfc3339();
    let updated = connection
        .execute(
            "UPDATE molecules SET
                mol_file_path = CASE WHEN ?2 = '' THEN mol_file_path ELSE ?2 END,
                sdf_file_path = CASE WHEN ?3 = '' THEN sdf_file_path ELSE ?3 END,
                pdb_file_path = CASE WHEN ?4 = '' THEN pdb_file_path ELSE ?4 END,
                updated_at = ?5
             WHERE id = ?1",
            rusqlite::params![
                molecule_id,
                &published.mol_path,
                &published.sdf_path,
                &published.pdb_path,
                &now
            ],
        )
        .map_err(|err| {
            format!("Failed to record the generated structure for {molecule_id}: {err}")
        })?;
    if updated == 0 {
        // The molecule was deleted while the sidecar was working. The staged files are removed by
        // their guards, and nothing that survives points at them.
        return Err(format!(
            "Molecule {molecule_id} no longer exists, so the generated structure was discarded."
        ));
    }

    // Published. The new files are now referenced, so they stop being temporary.
    for file in &mut staged {
        file.keep();
    }

    // Only now may the superseded files go. The database is already correct, so anything that
    // goes wrong here is reported rather than hidden — including a stored path that cannot be
    // resolved safely, which is a sign the row was written by something other than this build.
    let mut cleanup_failures = Vec::new();
    let mut removed = 0_usize;
    for (previous, replacement) in [
        (previous_mol, &published.mol_path),
        (previous_sdf, &published.sdf_path),
        (previous_pdb, &published.pdb_path),
    ] {
        let previous = previous.trim();
        // Nothing to clean when the slot was empty or is not being replaced.
        if previous.is_empty() || replacement.is_empty() || previous == replacement.as_str() {
            continue;
        }
        // Resolution is what keeps this from deleting outside the workspace, so its failures are
        // exactly the ones worth surfacing: an absolute path, a traversal, or a symlink that
        // leaves the workspace all land here, and none of them is deleted.
        let resolved = match crate::commands::attachments::resolve_in_workspace(workspace, previous)
        {
            Ok(resolved) => resolved,
            Err(err) => {
                cleanup_failures.push(format!(
                    "{previous}: the superseded structure could not be removed because {err}"
                ));
                continue;
            }
        };
        if !resolved.exists() {
            cleanup_failures.push(format!(
                "{previous}: the superseded structure was already gone from the workspace."
            ));
            continue;
        }
        match fs::remove_file(&resolved) {
            // `replaced` counts files that are actually gone, not attempts.
            Ok(()) => removed += 1,
            Err(err) => cleanup_failures.push(format!(
                "{previous}: the superseded structure could not be removed ({err})"
            )),
        }
    }
    published.replaced = removed;
    published.cleanup_failures = cleanup_failures;
    Ok(published)
}

#[tauri::command]
pub async fn convert_molecule_format(
    app: AppHandle,
    input_text: String,
    input_format: String,
    output_format: String,
    generate_2d: Option<bool>,
) -> Result<Value, String> {
    if input_text.trim().is_empty() {
        return Err("There is no structure to convert.".to_string());
    }
    run_sidecar_command(
        &app,
        "convert-format",
        json!({
            "input_text": input_text,
            "input_format": input_format,
            "output_format": output_format,
            "generate_2d": generate_2d.unwrap_or(false)
        }),
    )
    .await
}

/// Converts and writes a structure file, then reports where it landed.
///
/// A path chosen by the user is honoured; otherwise the file goes to the workspace `exports/`
/// directory, which is the documented destination.
#[tauri::command]
pub async fn export_molecule_file(
    app: AppHandle,
    input_text: String,
    input_format: String,
    output_format: String,
    save_path: Option<String>,
) -> Result<Value, String> {
    let output_format = output_format.trim().to_ascii_lowercase();
    let extension = EXPORT_FORMATS
        .iter()
        .find(|(name, _)| *name == output_format)
        .map(|(_, extension)| *extension)
        .ok_or_else(|| {
            let supported = EXPORT_FORMATS
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(", ");
            format!("Unsupported export format '{output_format}'. Supported formats: {supported}.")
        })?;

    let converted = convert_molecule_format(
        app.clone(),
        input_text,
        input_format,
        output_format.clone(),
        None,
    )
    .await?;
    let content = converted
        .pointer("/data/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "The sidecar returned no converted structure.".to_string())?;
    if content.trim().is_empty() {
        return Err(format!(
            "The conversion produced an empty {} file, so nothing was written.",
            output_format.to_uppercase()
        ));
    }

    let path = resolve_export_path(&app, save_path.as_deref(), extension)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create the export directory: {err}"))?;
    }
    fs::write(&path, content)
        .map_err(|err| format!("Failed to write {}: {err}", path.display()))?;

    ok(
        "export_molecule_file",
        json!({
            "output_format": output_format,
            "path": path,
            "bytes": content.len(),
            "mode": "real"
        }),
    )
}

fn resolve_export_path(
    app: &AppHandle,
    save_path: Option<&str>,
    extension: &str,
) -> Result<PathBuf, String> {
    match save_path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(requested) => {
            let path = Path::new(requested);
            if !path.is_absolute() {
                return Err(
                    "The export path must be absolute so the file lands where you expect."
                        .to_string(),
                );
            }
            Ok(path.to_path_buf())
        }
        None => {
            let directory = default_workspace_dir(app)?.join("exports");
            Ok(directory.join(format!(
                "structure-{}.{extension}",
                chrono::Utc::now().format("%Y%m%d-%H%M%S")
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_MOL: &str = "\n  RDKit          3D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.5000    0.0000    0.0000 C   0  0\n    2.0000    1.2000    0.0000 O   0  0\n  1  2  1  0\n  2  3  1  0\nM  END\n";

    #[test]
    fn a_valid_molblock_reports_its_atoms() {
        assert_eq!(molblock_atom_count(VALID_MOL), 3);
    }

    #[test]
    fn a_block_without_coordinates_reports_no_atoms() {
        // Declares three atoms but supplies none, which is exactly the shape that must be refused.
        let empty = "\n  RDKit          3D\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\nM  END\n";
        assert_eq!(molblock_atom_count(empty), 0);
        assert_eq!(molblock_atom_count("not a molblock"), 0);
        assert_eq!(molblock_atom_count(""), 0);
    }

    #[test]
    fn a_block_declaring_zero_atoms_reports_none() {
        let zero = "\n  RDKit          3D\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n";
        assert_eq!(molblock_atom_count(zero), 0);
    }

    #[test]
    fn non_numeric_coordinates_are_not_counted_as_atoms() {
        let corrupt = "\n  RDKit          3D\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    x    y    z C   0  0\n    q    r    s O   0  0\n";
        assert_eq!(molblock_atom_count(corrupt), 0);
    }

    #[test]
    fn pdb_atoms_are_counted_from_atom_records() {
        let pdb = "HEADER    TEST\nATOM      1  C   UNL     1       0.000   0.000   0.000\nHETATM    2  O   UNL     1       1.500   0.000   0.000\nEND\n";
        assert_eq!(pdb_atom_count(pdb), 2);
        assert_eq!(pdb_atom_count("HEADER only\nEND\n"), 0);
    }

    #[test]
    fn every_export_format_maps_to_a_file_extension() {
        for (name, extension) in EXPORT_FORMATS {
            assert!(!name.is_empty());
            assert!(!extension.is_empty());
        }
        assert!(EXPORT_FORMATS.iter().any(|(name, _)| *name == "sdf"));
    }
}
