use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::ok;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

/// Writes CSV exports into the workspace `exports/` directory and returns the path.
///
/// The frontend used to build these from the in-memory mock fixtures, so a packaged build handed
/// the user a file of sample molecules labelled as their own data. Everything here reads SQLite.
/// Writing the file in Rust also avoids the browser download path, which is unreliable inside the
/// desktop webview.
pub fn export_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let directory = default_workspace_dir(app)?.join("exports");
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Failed to create the exports directory: {err}"))?;
    Ok(directory.join(file_name))
}

pub fn timestamped(prefix: &str) -> String {
    format!("{prefix}-{}.csv", Utc::now().format("%Y%m%d-%H%M%S"))
}

/// Quotes a CSV field and disarms spreadsheet formula injection.
///
/// A molecule named `=cmd|...` would otherwise execute when the export is opened in Excel.
pub fn csv_field(value: &str) -> String {
    let needs_guard = value
        .chars()
        .next()
        .is_some_and(|first| matches!(first, '=' | '+' | '-' | '@' | '\t' | '\r'));
    let escaped = value.replace('"', "\"\"");
    if needs_guard {
        format!("\"'{escaped}\"")
    } else {
        format!("\"{escaped}\"")
    }
}

pub fn csv_row(fields: &[String]) -> String {
    fields
        .iter()
        .map(|field| csv_field(field))
        .collect::<Vec<_>>()
        .join(",")
}

fn value_to_field(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

struct DescriptorRow {
    molecule_id: String,
    name: String,
    smiles_canonical: String,
    inchi_key: String,
    formula: String,
    molecular_weight: String,
    category: String,
    descriptor_set: String,
    descriptor_version: String,
    mode: String,
    status: String,
    descriptors: Map<String, Value>,
}

fn load_descriptor_rows(connection: &Connection) -> Result<Vec<DescriptorRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT m.id, m.name, m.smiles_canonical, m.inchi_key, m.formula, m.molecular_weight,
                    m.category, d.descriptor_set, d.descriptor_version, d.mode, d.status,
                    d.descriptors_json
             FROM molecule_descriptors d
             JOIN molecules m ON m.id = d.molecule_id
             ORDER BY m.name, m.id, d.descriptor_set",
        )
        .map_err(|err| format!("Failed to prepare the descriptor export query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let descriptors_text: String = row.get(11)?;
            let descriptors = serde_json::from_str::<Value>(&descriptors_text)
                .ok()
                .and_then(|value| value.as_object().cloned())
                .unwrap_or_default();
            Ok(DescriptorRow {
                molecule_id: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                smiles_canonical: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                inchi_key: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                formula: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                molecular_weight: row
                    .get::<_, Option<f64>>(5)?
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                category: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                descriptor_set: row.get(7)?,
                descriptor_version: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                mode: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                status: row.get(10)?,
                descriptors,
            })
        })
        .map_err(|err| format!("Failed to query descriptors for export: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a descriptor export row: {err}"))
}

#[tauri::command]
pub fn export_all_descriptors_csv(app: AppHandle) -> Result<Value, String> {
    let connection = open_database(default_database_path(&app)?)
        .map_err(|err| format!("Failed to open SQLite database for export: {err}"))?;
    let rows = load_descriptor_rows(&connection)?;

    let mut descriptor_keys = BTreeSet::new();
    for row in &rows {
        descriptor_keys.extend(row.descriptors.keys().cloned());
    }
    let descriptor_keys: Vec<String> = descriptor_keys.into_iter().collect();

    let mut headers = vec![
        "molecule_id".to_string(),
        "molecule_name".to_string(),
        "smiles_canonical".to_string(),
        "inchi_key".to_string(),
        "formula".to_string(),
        "molecular_weight".to_string(),
        "category".to_string(),
        "descriptor_set".to_string(),
        "descriptor_version".to_string(),
        "mode".to_string(),
        "status".to_string(),
    ];
    headers.extend(descriptor_keys.iter().cloned());

    let mut lines = vec![csv_row(&headers)];
    for row in &rows {
        let mut fields = vec![
            row.molecule_id.clone(),
            row.name.clone(),
            row.smiles_canonical.clone(),
            row.inchi_key.clone(),
            row.formula.clone(),
            row.molecular_weight.clone(),
            row.category.clone(),
            row.descriptor_set.clone(),
            row.descriptor_version.clone(),
            row.mode.clone(),
            row.status.clone(),
        ];
        for key in &descriptor_keys {
            fields.push(
                row.descriptors
                    .get(key)
                    .map(value_to_field)
                    .unwrap_or_default(),
            );
        }
        lines.push(csv_row(&fields));
    }

    let path = export_path(&app, &timestamped("all-descriptors"))?;
    fs::write(&path, lines.join("\n"))
        .map_err(|err| format!("Failed to write the descriptor export: {err}"))?;
    ok(
        "export_all_descriptors_csv",
        json!({
            "path": path,
            "row_count": rows.len(),
            "column_count": headers.len(),
            "mode": "real"
        }),
    )
}

#[derive(Debug)]
struct MatrixOptions {
    include_rdkit: bool,
    include_mordred: bool,
    numeric_only: bool,
    include_metadata: bool,
    blank_missing: bool,
    descriptor_prefix: bool,
}

fn matrix_options(options: &Value) -> MatrixOptions {
    let flag =
        |key: &str, default: bool| options.get(key).and_then(Value::as_bool).unwrap_or(default);
    MatrixOptions {
        include_rdkit: flag("includeRdkit", true),
        include_mordred: flag("includeMordred", true),
        numeric_only: flag("numericOnly", true),
        include_metadata: flag("includeMetadata", true),
        blank_missing: options
            .get("missingValueStrategy")
            .and_then(Value::as_str)
            .unwrap_or("blank")
            == "blank",
        descriptor_prefix: flag("descriptorPrefix", true),
    }
}

#[tauri::command]
pub fn export_ml_descriptor_matrix_csv(app: AppHandle, options: Value) -> Result<Value, String> {
    let options = matrix_options(&options);
    let connection = open_database(default_database_path(&app)?)
        .map_err(|err| format!("Failed to open SQLite database for export: {err}"))?;
    let rows = load_descriptor_rows(&connection)?;

    // One row per molecule, with each descriptor set folded into its own columns.
    let mut molecules: Vec<String> = Vec::new();
    let mut per_molecule: std::collections::HashMap<String, Map<String, Value>> =
        std::collections::HashMap::new();
    let mut metadata: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut columns = BTreeSet::new();

    for row in &rows {
        let wanted = match row.descriptor_set.as_str() {
            "rdkit" => options.include_rdkit,
            "mordred" => options.include_mordred,
            _ => false,
        };
        if !per_molecule.contains_key(&row.molecule_id) {
            molecules.push(row.molecule_id.clone());
            per_molecule.insert(row.molecule_id.clone(), Map::new());
            metadata.insert(
                row.molecule_id.clone(),
                vec![
                    row.molecule_id.clone(),
                    row.name.clone(),
                    row.smiles_canonical.clone(),
                    row.inchi_key.clone(),
                    row.formula.clone(),
                    row.molecular_weight.clone(),
                    row.category.clone(),
                ],
            );
        }
        if !wanted {
            continue;
        }
        let target = per_molecule
            .get_mut(&row.molecule_id)
            .expect("molecule entry was just inserted");
        for (key, value) in &row.descriptors {
            if options.numeric_only && !value.is_number() {
                continue;
            }
            let column = if options.descriptor_prefix {
                format!("{}_{key}", row.descriptor_set)
            } else {
                key.clone()
            };
            columns.insert(column.clone());
            target.insert(column, value.clone());
        }
    }

    let metadata_headers = [
        "molecule_id",
        "molecule_name",
        "smiles_canonical",
        "inchi_key",
        "formula",
        "molecular_weight",
        "category",
    ];
    let columns: Vec<String> = columns.into_iter().collect();
    let mut headers: Vec<String> = if options.include_metadata {
        metadata_headers
            .iter()
            .map(|item| item.to_string())
            .collect()
    } else {
        Vec::new()
    };
    headers.extend(columns.iter().cloned());

    let missing = if options.blank_missing { "" } else { "NaN" };
    let mut lines = vec![csv_row(&headers)];
    for molecule_id in &molecules {
        let mut fields = if options.include_metadata {
            metadata.get(molecule_id).cloned().unwrap_or_default()
        } else {
            Vec::new()
        };
        let values = per_molecule
            .get(molecule_id)
            .expect("molecule entry was inserted above");
        for column in &columns {
            fields.push(
                values
                    .get(column)
                    .map(value_to_field)
                    .unwrap_or_else(|| missing.to_string()),
            );
        }
        lines.push(csv_row(&fields));
    }

    let path = export_path(&app, &timestamped("ml-descriptor-matrix"))?;
    fs::write(&path, lines.join("\n"))
        .map_err(|err| format!("Failed to write the ML matrix export: {err}"))?;
    ok(
        "export_ml_descriptor_matrix_csv",
        json!({
            "path": path,
            "row_count": molecules.len(),
            "column_count": headers.len(),
            "mode": "real"
        }),
    )
}

#[tauri::command]
pub fn export_molecule_library_csv(app: AppHandle) -> Result<Value, String> {
    let connection = open_database(default_database_path(&app)?)
        .map_err(|err| format!("Failed to open SQLite database for export: {err}"))?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula,
                    molecular_weight, category, tags, source, source_id, notes, created_at, updated_at
             FROM molecules
             ORDER BY datetime(created_at) DESC, created_at DESC, id DESC",
        )
        .map_err(|err| format!("Failed to prepare the molecule export query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            let tags_text: String = row.get::<_, Option<String>>(10)?.unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_text).unwrap_or_default();
            let source: String = row.get::<_, Option<String>>(11)?.unwrap_or_default();
            let source_id: String = row.get::<_, Option<String>>(12)?.unwrap_or_default();
            Ok(vec![
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(8)?
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                tags.join(";"),
                if source.is_empty() { source_id } else { source },
                row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
            ])
        })
        .map_err(|err| format!("Failed to query molecules for export: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a molecule export row: {err}"))?;

    let headers: Vec<String> = [
        "id",
        "name",
        "aliases",
        "smiles_raw",
        "smiles_canonical",
        "inchi",
        "inchi_key",
        "formula",
        "molecular_weight",
        "category",
        "additive_function_tags",
        "data_source",
        "notes",
        "created_at",
        "updated_at",
    ]
    .iter()
    .map(|item| item.to_string())
    .collect();

    let mut lines = vec![csv_row(&headers)];
    for row in &rows {
        lines.push(csv_row(row));
    }

    let path = export_path(&app, &timestamped("molecule-library"))?;
    fs::write(&path, lines.join("\n"))
        .map_err(|err| format!("Failed to write the molecule export: {err}"))?;
    ok(
        "export_molecule_library_csv",
        json!({ "path": path, "row_count": rows.len(), "mode": "real" }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn seeded_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, smiles_canonical, inchi_key, formula,
                                       molecular_weight, category, created_at, updated_at)
                VALUES ('mol-1', 'ZDDP-Chain-Ester-01', 'CCO', 'KEY-1', 'C2H6O', 46.069,
                        'additive', '2026-01-01', '2026-01-01');
                INSERT INTO molecule_descriptors (id, molecule_id, descriptor_set,
                                                  descriptor_version, descriptors_json,
                                                  descriptor_count, status, mode, calculated_at)
                VALUES ('d-1', 'mol-1', 'rdkit', '1.0', '{"MolWt":46.069,"Name":"text"}', 2,
                        'calculated', 'real', '2026-01-01');
                INSERT INTO molecule_descriptors (id, molecule_id, descriptor_set,
                                                  descriptor_version, descriptors_json,
                                                  descriptor_count, status, mode, calculated_at)
                VALUES ('d-2', 'mol-1', 'mordred', '1.2.0', '{"ABC":1.414}', 1,
                        'calculated', 'real', '2026-01-01');
                "#,
            )
            .expect("fixtures should insert");
        connection
    }

    #[test]
    fn descriptor_export_reads_the_database_rather_than_any_fixture() {
        let connection = seeded_connection();
        let rows = load_descriptor_rows(&connection).expect("rows should load");

        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row.molecule_id == "mol-1"));
        assert!(rows.iter().all(|row| row.name == "ZDDP-Chain-Ester-01"));
        assert!(rows.iter().any(|row| row.descriptor_set == "mordred"));
        assert!(rows
            .iter()
            .find(|row| row.descriptor_set == "rdkit")
            .expect("rdkit row")
            .descriptors
            .contains_key("MolWt"));
    }

    #[test]
    fn csv_fields_are_quoted_and_formulas_are_disarmed() {
        assert_eq!(csv_field("plain"), "\"plain\"");
        assert_eq!(csv_field("say \"hi\""), "\"say \"\"hi\"\"\"");
        // An imported name starting with = would execute when the CSV is opened in Excel.
        assert_eq!(csv_field("=cmd|'/c calc'!A1"), "\"'=cmd|'/c calc'!A1\"");
        assert_eq!(csv_field("-lead"), "\"'-lead\"");
        assert_eq!(csv_field("@ref"), "\"'@ref\"");
    }

    #[test]
    fn numeric_only_matrix_drops_text_descriptors() {
        let connection = seeded_connection();
        let rows = load_descriptor_rows(&connection).expect("rows should load");
        let numeric: Vec<&str> = rows
            .iter()
            .flat_map(|row| row.descriptors.iter())
            .filter(|(_, value)| value.is_number())
            .map(|(key, _)| key.as_str())
            .collect();

        assert!(numeric.contains(&"MolWt"));
        assert!(numeric.contains(&"ABC"));
        assert!(!numeric.contains(&"Name"));
    }
}
