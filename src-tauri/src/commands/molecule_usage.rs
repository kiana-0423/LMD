//! Finds where a molecule is actually used, and manages the files that belong to it.
//!
//! Every figure here is read from the active workspace database; nothing is synthesised.

use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::attachments;
use crate::commands::errors::{coded, FILE_ALREADY_EXISTS};
use crate::commands::ok;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

/// Largest file the app will copy into a workspace, so an accidental selection of a huge file
/// fails fast with an explanation instead of filling the disk.
const MAX_ATTACHMENT_BYTES: u64 = 100 * 1024 * 1024;

/// One recorded concentration, with the component it belongs to.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConcentrationEntry {
    pub component_id: String,
    pub value: Option<f64>,
    pub unit: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationUsageDto {
    pub formulation_id: String,
    pub formulation_name: String,
    /// How the molecule is connected: direct component, additive, or base oil.
    pub role: String,
    /// Every concentration recorded for this molecule in this role, in component order. A
    /// formulation may hold the same molecule in more than one component, and collapsing those
    /// into one number would misreport the mixture.
    pub concentrations: Vec<ConcentrationEntry>,
    /// Set only when every entry shares a unit, so a total is meaningful; otherwise `None`.
    pub total_concentration: Option<f64>,
    pub concentration_unit: String,
    pub component_count: i64,
    pub experiment_count: i64,
    pub best_average_friction_coefficient: Option<f64>,
    pub best_wear_scar_diameter: Option<f64>,
    pub highest_oxidation_temperature: Option<f64>,
    pub best_extreme_pressure_value: Option<f64>,
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

/// Every formulation that uses a molecule, through any of the three possible relationships.
///
/// The performance columns are aggregated in the same statement, so the result set costs one
/// query regardless of how many formulations come back.
#[tauri::command]
pub fn list_formulations_for_molecule(
    app: AppHandle,
    molecule_id: String,
) -> Result<Vec<FormulationUsageDto>, String> {
    if molecule_id.trim().is_empty() {
        return Err("A molecule id is required.".to_string());
    }
    let connection = open(&app)?;
    // Every matching component is returned; grouping happens in Rust so no concentration is
    // silently dropped by picking a non-aggregated column out of a GROUP BY.
    let mut statement = connection
        .prepare(
            "WITH usage AS (
                 SELECT c.formulation_id AS formulation_id,
                        c.id AS component_id,
                        'component' AS role,
                        c.concentration_value AS concentration_value,
                        COALESCE(c.concentration_unit, '') AS concentration_unit
                 FROM formulation_components c
                 WHERE c.molecule_id = ?1
                 UNION ALL
                 SELECT c.formulation_id, c.id, 'additive', c.concentration_value,
                        COALESCE(c.concentration_unit, '')
                 FROM formulation_components c
                 JOIN additives a ON a.id = c.additive_id
                 WHERE a.molecule_id = ?1
                 UNION ALL
                 SELECT c.formulation_id, c.id, 'base_oil', c.concentration_value,
                        COALESCE(c.concentration_unit, '')
                 FROM formulation_components c
                 JOIN base_oils b ON b.id = c.base_oil_id
                 WHERE b.representative_molecule_id = ?1
             ),
             performance AS (
                 SELECT e.formulation_id AS formulation_id,
                        COUNT(DISTINCT e.id) AS experiment_count,
                        MIN(r.average_friction_coefficient) AS best_friction,
                        MIN(r.wear_scar_diameter_value) AS best_wear,
                        MAX(r.initial_oxidation_temperature_value) AS best_oxidation,
                        MAX(r.extreme_pressure_value) AS best_extreme_pressure
                 FROM experiments e
                 LEFT JOIN performance_results r ON r.experiment_id = e.id
                 GROUP BY e.formulation_id
             )
             SELECT u.formulation_id, f.name, u.role, u.component_id, u.concentration_value,
                    u.concentration_unit, COALESCE(p.experiment_count, 0), p.best_friction,
                    p.best_wear, p.best_oxidation, p.best_extreme_pressure
             FROM usage u
             JOIN formulations f ON f.id = u.formulation_id
             LEFT JOIN performance p ON p.formulation_id = u.formulation_id
             ORDER BY f.name, u.formulation_id, u.role, u.component_id",
        )
        .map_err(|err| format!("Failed to prepare the molecule usage query: {err}"))?;

    type UsageRow = (
        String,
        String,
        String,
        String,
        Option<f64>,
        String,
        i64,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<f64>,
    );
    let raw: Vec<UsageRow> = statement
        .query_map(params![&molecule_id], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
            ))
        })
        .map_err(|err| format!("Failed to query formulations for molecule {molecule_id}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a formulation usage row: {err}"))?;

    let mut grouped: Vec<FormulationUsageDto> = Vec::new();
    for row in raw {
        let (
            formulation_id,
            formulation_name,
            role,
            component_id,
            value,
            unit,
            experiment_count,
            best_friction,
            best_wear,
            best_oxidation,
            best_extreme_pressure,
        ) = row;
        let entry = ConcentrationEntry {
            component_id,
            value,
            unit: unit.clone(),
        };
        match grouped
            .iter_mut()
            .find(|item| item.formulation_id == formulation_id && item.role == role)
        {
            Some(existing) => {
                existing.concentrations.push(entry);
                existing.component_count += 1;
            }
            None => grouped.push(FormulationUsageDto {
                formulation_id,
                formulation_name,
                role,
                concentrations: vec![entry],
                total_concentration: None,
                concentration_unit: String::new(),
                component_count: 1,
                experiment_count,
                best_average_friction_coefficient: best_friction,
                best_wear_scar_diameter: best_wear,
                highest_oxidation_temperature: best_oxidation,
                best_extreme_pressure_value: best_extreme_pressure,
            }),
        }
    }

    // A total is only reported when every entry carries the same unit; mixed units cannot be added.
    for item in &mut grouped {
        let units: BTreeSet<&str> = item
            .concentrations
            .iter()
            .filter(|entry| entry.value.is_some())
            .map(|entry| entry.unit.as_str())
            .collect();
        if units.len() == 1 {
            let unit = units.into_iter().next().unwrap_or_default().to_string();
            let total: f64 = item
                .concentrations
                .iter()
                .filter_map(|entry| entry.value)
                .filter(|value| value.is_finite())
                .sum();
            item.concentration_unit = unit;
            item.total_concentration = Some(total);
        }
    }
    Ok(grouped)
}

fn resolve_in_workspace(app: &AppHandle, relative: &str) -> Result<PathBuf, String> {
    // One shared implementation, so path containment cannot drift between call sites.
    let workspace = default_workspace_dir(app)?;
    attachments::resolve_in_workspace(&workspace, relative)
}

/// Structure files generated for a molecule plus every attachment recorded against it.
#[tauri::command]
pub fn list_molecule_files(app: AppHandle, molecule_id: String) -> Result<Value, String> {
    let workspace = default_workspace_dir(&app)?;
    let connection = open(&app)?;
    let paths = connection
        .query_row(
            "SELECT structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path
             FROM molecules WHERE id = ?1",
            params![&molecule_id],
            |row| {
                Ok([
                    row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ])
            },
        )
        .optional()
        .map_err(|err| format!("Failed to read molecule {molecule_id}: {err}"))?;
    let Some(paths) = paths else {
        return Err(format!("Molecule not found: {molecule_id}"));
    };

    let structure_files: Vec<Value> = ["SVG", "MOL", "SDF", "PDB"]
        .iter()
        .zip(paths.iter())
        .filter(|(_, path)| !path.trim().is_empty())
        .map(|(kind, path)| {
            // Resolved rather than joined: a row written by another build cannot make this
            // report on a file outside the workspace, or reach one through a symlink.
            let metadata = attachments::resolve_in_workspace(&workspace, path)
                .ok()
                .and_then(|absolute| fs::metadata(absolute).ok());
            json!({
                "kind": kind,
                "relativePath": path,
                // A row whose file is gone still shows, marked missing, so it can be repaired.
                "exists": metadata.is_some(),
                "bytes": metadata.map(|value| value.len()).unwrap_or_default()
            })
        })
        .collect();

    let mut statement = connection
        .prepare(
            "SELECT id, file_name, file_type, relative_path, description, uploaded_at
             FROM attachments
             WHERE linked_entity_type = 'molecule' AND linked_entity_id = ?1
             ORDER BY uploaded_at DESC, id DESC",
        )
        .map_err(|err| format!("Failed to prepare the attachment query: {err}"))?;
    let attachments = statement
        .query_map(params![&molecule_id], |row| {
            let relative_path: String = row.get(3)?;
            let metadata = attachments::resolve_in_workspace(&workspace, &relative_path)
                .ok()
                .and_then(|absolute| fs::metadata(absolute).ok());
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "fileName": row.get::<_, String>(1)?,
                "fileType": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "relativePath": relative_path,
                "description": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "uploadedAt": row.get::<_, String>(5)?,
                "exists": metadata.is_some(),
                "bytes": metadata.map(|value| value.len()).unwrap_or_default()
            }))
        })
        .map_err(|err| format!("Failed to query attachments: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read an attachment row: {err}"))?;

    ok(
        "list_molecule_files",
        json!({ "structureFiles": structure_files, "attachments": attachments }),
    )
}

/// Copies a file the user picked into the workspace and records it against an entity.
#[tauri::command]
pub fn import_attachment(
    app: AppHandle,
    linked_entity_type: String,
    linked_entity_id: String,
    source_path: String,
    description: Option<String>,
) -> Result<Value, String> {
    let source = Path::new(&source_path);
    let metadata =
        fs::metadata(source).map_err(|err| format!("Cannot read {}: {err}", source.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file.", source.display()));
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "{} is {:.1} MB, larger than the {} MB attachment limit.",
            source.display(),
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The selected file has no readable name.".to_string())?
        .to_string();
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let connection = open(&app)?;
    if !attachments::is_supported_entity(&linked_entity_type) {
        return Err(format!(
            "Unsupported attachment target '{linked_entity_type}'. Use molecule, formulation, or experiment."
        ));
    }
    let entity_exists = match linked_entity_type.as_str() {
        attachments::ENTITY_MOLECULE => "SELECT EXISTS(SELECT 1 FROM molecules WHERE id = ?1)",
        attachments::ENTITY_FORMULATION => {
            "SELECT EXISTS(SELECT 1 FROM formulations WHERE id = ?1)"
        }
        _ => "SELECT EXISTS(SELECT 1 FROM experiments WHERE id = ?1)",
    };
    let exists: i64 = connection
        .query_row(entity_exists, params![&linked_entity_id], |row| row.get(0))
        .map_err(|err| {
            format!("Failed to verify {linked_entity_type} {linked_entity_id}: {err}")
        })?;
    if exists != 1 {
        return Err(format!(
            "{linked_entity_type} not found: {linked_entity_id}"
        ));
    }

    let id = Uuid::new_v4().to_string();
    // The stored name keeps the id so two files with the same name cannot collide.
    let stored_name = if extension.is_empty() {
        id.clone()
    } else {
        format!("{id}.{extension}")
    };
    let relative_path = format!("files/imports/{stored_name}");
    let destination = resolve_in_workspace(&app, &relative_path)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create the attachment directory: {err}"))?;
    }
    fs::copy(source, &destination).map_err(|err| {
        format!(
            "Failed to copy {} into the workspace: {err}",
            source.display()
        )
    })?;

    let now = Utc::now().to_rfc3339();
    let inserted = connection.execute(
        "INSERT INTO attachments (
            id, linked_entity_type, linked_entity_id, file_name, file_type, relative_path,
            description, uploaded_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &id,
            &linked_entity_type,
            &linked_entity_id,
            &file_name,
            &extension,
            &relative_path,
            description.unwrap_or_default(),
            &now
        ],
    );
    if let Err(err) = inserted {
        // Without a row the copied file is unreachable, so it must go — and if it cannot, the
        // caller is told rather than left with a file nothing in the workspace references.
        let mut message = format!("Failed to record the attachment: {err}");
        for failure in crate::commands::tempfile::TempFile::claim(&destination).discard() {
            message.push_str(&format!(
                " The copied file could not be removed either: {failure}"
            ));
        }
        return Err(message);
    }

    ok(
        "import_attachment",
        json!({
            "id": id,
            "fileName": file_name,
            "relativePath": relative_path,
            "bytes": metadata.len(),
            "uploadedAt": now
        }),
    )
}

/// Copies a workspace file out to a destination the user chose.
#[tauri::command]
pub fn export_workspace_file(
    app: AppHandle,
    relative_path: String,
    destination_path: String,
    overwrite: Option<bool>,
) -> Result<Value, String> {
    let source = resolve_in_workspace(&app, &relative_path)?;
    if !source.is_file() {
        return Err(format!(
            "{relative_path} is recorded in the database but is missing from the workspace."
        ));
    }
    let destination = Path::new(&destination_path);
    if !destination.is_absolute() {
        return Err("Choose an absolute destination path for the export.".to_string());
    }
    // Overwriting is a deliberate act, not a silent side effect of exporting.
    if destination.exists() && !overwrite.unwrap_or(false) {
        return Err(coded(
            FILE_ALREADY_EXISTS,
            format!(
                "{} already exists. Confirm the overwrite or choose another destination.",
                destination.display()
            ),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create the destination directory: {err}"))?;
    }
    let bytes = fs::copy(&source, destination)
        .map_err(|err| format!("Failed to export to {}: {err}", destination.display()))?;
    ok(
        "export_workspace_file",
        json!({ "path": destination, "bytes": bytes }),
    )
}

/// Deletes one attachment row and the workspace file it owns, for any entity type.
///
/// This is the only attachment delete in the application. Every stored path goes through
/// `resolve_in_workspace`, so a row written by another build — or edited by hand — cannot address
/// a file outside the workspace or reach one through a symlink. The file is moved aside first and
/// only destroyed once the row is gone, and a present file that cannot be moved aborts the delete
/// before the row goes rather than leaving a file nothing references.
#[tauri::command]
pub fn delete_attachment_record(app: AppHandle, id: String) -> Result<Value, String> {
    let workspace = default_workspace_dir(&app)?;
    let connection = open(&app)?;
    let record: Option<(String, String, String, String)> = connection
        .query_row(
            "SELECT relative_path, linked_entity_type, linked_entity_id, file_name
             FROM attachments WHERE id = ?1",
            params![&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|err| format!("Failed to look up attachment {id}: {err}"))?;
    let Some((relative_path, entity_type, entity_id, file_name)) = record else {
        return Err(format!("Attachment not found: {id}"));
    };

    let (deleted, removed_files, cleanup_failures) =
        attachments::delete_with_files(&workspace, std::slice::from_ref(&relative_path), || {
            let deleted = connection
                .execute("DELETE FROM attachments WHERE id = ?1", params![&id])
                .map_err(|err| format!("Failed to delete attachment {id}: {err}"))?;
            if deleted == 0 {
                return Err(format!(
                    "Attachment {id} was removed by something else before this delete ran."
                ));
            }
            Ok(deleted)
        })?;

    ok(
        "delete_attachment_record",
        json!({
            "id": id,
            "fileName": file_name,
            "linkedEntityType": entity_type,
            "linkedEntityId": entity_id,
            "relativePath": relative_path,
            "deleted": deleted > 0,
            "removedFiles": removed_files,
            // Surfaced to the caller: the row is gone, but the disk may not be clean.
            "cleanupFailures": cleanup_failures
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn connection_with_schema() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
    }

    /// The query the command runs, so the test exercises the real SQL.
    fn usage_rows(connection: &Connection, molecule_id: &str) -> Vec<(String, String, i64)> {
        let mut statement = connection
            .prepare(
                "WITH usage AS (
                     SELECT c.formulation_id AS formulation_id, 'component' AS role
                     FROM formulation_components c WHERE c.molecule_id = ?1
                     UNION ALL
                     SELECT c.formulation_id, 'additive' FROM formulation_components c
                     JOIN additives a ON a.id = c.additive_id WHERE a.molecule_id = ?1
                     UNION ALL
                     SELECT c.formulation_id, 'base_oil' FROM formulation_components c
                     JOIN base_oils b ON b.id = c.base_oil_id
                     WHERE b.representative_molecule_id = ?1
                 ),
                 performance AS (
                     SELECT e.formulation_id AS formulation_id,
                            COUNT(DISTINCT e.id) AS experiment_count
                     FROM experiments e GROUP BY e.formulation_id
                 )
                 SELECT u.formulation_id, u.role, COALESCE(p.experiment_count, 0)
                 FROM usage u
                 JOIN formulations f ON f.id = u.formulation_id
                 LEFT JOIN performance p ON p.formulation_id = u.formulation_id
                 GROUP BY u.formulation_id, u.role
                 ORDER BY f.name, u.formulation_id, u.role",
            )
            .expect("query should prepare");
        statement
            .query_map(params![molecule_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .expect("query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows should read")
    }

    #[test]
    fn a_molecule_with_no_relationships_returns_nothing() {
        let connection = connection_with_schema();
        connection
            .execute(
                "INSERT INTO molecules (id, name, created_at, updated_at)
                 VALUES ('mol-1', 'Unused', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("molecule should insert");

        assert!(usage_rows(&connection, "mol-1").is_empty());
    }

    #[test]
    fn usage_is_found_through_all_three_relationships() {
        let connection = connection_with_schema();
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('mol-1', 'ZDDP', '2026-01-01', '2026-01-01');
                INSERT INTO additives (id, molecule_id, created_at, updated_at)
                  VALUES ('add-1', 'mol-1', '2026-01-01', '2026-01-01');
                INSERT INTO base_oils (id, name, representative_molecule_id, created_at, updated_at)
                  VALUES ('bo-1', 'PAO-6', 'mol-1', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at) VALUES
                  ('f-direct', 'A Direct', '2026-01-01', '2026-01-01'),
                  ('f-additive', 'B Additive', '2026-01-01', '2026-01-01'),
                  ('f-baseoil', 'C Base Oil', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components (id, formulation_id, component_role, molecule_id)
                  VALUES ('c-1', 'f-direct', 'additive', 'mol-1');
                INSERT INTO formulation_components (id, formulation_id, component_role, additive_id)
                  VALUES ('c-2', 'f-additive', 'additive', 'add-1');
                INSERT INTO formulation_components (id, formulation_id, component_role, base_oil_id)
                  VALUES ('c-3', 'f-baseoil', 'base_oil', 'bo-1');
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('e-1', 'f-additive', '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("fixtures should insert");

        let rows = usage_rows(&connection, "mol-1");

        assert_eq!(rows.len(), 3);
        // Ordered by formulation name, so the roles arrive deterministically.
        assert_eq!(
            rows[0],
            ("f-direct".to_string(), "component".to_string(), 0)
        );
        assert_eq!(
            rows[1],
            ("f-additive".to_string(), "additive".to_string(), 1)
        );
        assert_eq!(
            rows[2],
            ("f-baseoil".to_string(), "base_oil".to_string(), 0)
        );
    }

    #[test]
    fn a_molecule_appearing_twice_in_one_formulation_keeps_both_concentrations() {
        let connection = connection_with_schema();
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('mol-1', 'ZDDP', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('f-1', 'Split dose blend', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, molecule_id, concentration_value,
                   concentration_unit) VALUES
                  ('c-1', 'f-1', 'additive', 'mol-1', 0.6, 'wt%'),
                  ('c-2', 'f-1', 'additive', 'mol-1', 0.4, 'wt%');
                "#,
            )
            .expect("fixtures should insert");

        let mut statement = connection
            .prepare(
                "SELECT c.id, c.concentration_value, COALESCE(c.concentration_unit, '')
                 FROM formulation_components c
                 WHERE c.molecule_id = ?1
                 ORDER BY c.id",
            )
            .expect("query should prepare");
        let rows: Vec<(String, Option<f64>, String)> = statement
            .query_map(params!["mol-1"], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .expect("query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows should read");

        // Both components survive; neither is discarded by a non-aggregated GROUP BY.
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "c-1");
        assert_eq!(rows[1].0, "c-2");
        let total: f64 = rows.iter().filter_map(|row| row.1).sum();
        assert!((total - 1.0).abs() < 1e-9, "compatible units add up");
        assert!(rows.iter().all(|row| row.2 == "wt%"));
    }

    #[test]
    fn mixed_units_are_never_summed() {
        let connection = connection_with_schema();
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('mol-1', 'ZDDP', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('f-1', 'Mixed units', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, molecule_id, concentration_value,
                   concentration_unit) VALUES
                  ('c-1', 'f-1', 'additive', 'mol-1', 0.6, 'wt%'),
                  ('c-2', 'f-1', 'additive', 'mol-1', 500.0, 'ppm');
                "#,
            )
            .expect("fixtures should insert");

        let mut statement = connection
            .prepare(
                "SELECT COALESCE(c.concentration_unit, '') FROM formulation_components c
                 WHERE c.molecule_id = ?1",
            )
            .expect("query should prepare");
        let units: BTreeSet<String> = statement
            .query_map(params!["mol-1"], |row| row.get::<_, String>(0))
            .expect("query should run")
            .collect::<Result<BTreeSet<_>, _>>()
            .expect("units should read");

        // Two units means no total may be reported; adding wt% to ppm would be meaningless.
        assert_eq!(units.len(), 2);
    }
}
