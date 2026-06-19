use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::db::schema::INIT_SCHEMA_SQL;
use rusqlite::Connection;
use std::fs;
use tauri::AppHandle;

pub fn initialize_database_file(app: &AppHandle) -> Result<(), String> {
    let workspace = default_workspace_dir(app)?;
    create_workspace_directories(&workspace)?;
    let db_path = default_database_path(app)?;
    let connection = Connection::open(db_path)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))?;
    connection
        .execute_batch(INIT_SCHEMA_SQL)
        .map_err(|err| format!("Failed to initialize SQLite schema: {err}"))?;
    migrate_molecules_table(&connection)?;
    create_indexes(&connection)?;
    Ok(())
}

fn migrate_molecules_table(connection: &Connection) -> Result<(), String> {
    let create_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'molecules'",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to inspect molecules table: {err}"))?;
    let needs_rebuild = create_sql.contains("inchi_key TEXT UNIQUE")
        || !column_exists(connection, "molecules", "duplicate_of")?;
    if !needs_rebuild {
        return Ok(());
    }

    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = OFF;
            CREATE TABLE IF NOT EXISTS molecules_new (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              aliases TEXT,
              smiles_raw TEXT,
              smiles_canonical TEXT,
              inchi TEXT,
              inchi_key TEXT,
              formula TEXT,
              molecular_weight REAL,
              category TEXT,
              tags TEXT,
              molfile TEXT,
              descriptor_json TEXT,
              duplicate_of TEXT,
              import_mode TEXT,
              source TEXT,
              structure_svg_path TEXT,
              mol_file_path TEXT,
              sdf_file_path TEXT,
              pdb_file_path TEXT,
              rdkit_descriptor_status TEXT,
              mordred_descriptor_status TEXT,
              descriptor_ready INTEGER DEFAULT 0,
              source_id TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO molecules_new (
              id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
              category, tags, molfile, descriptor_json, duplicate_of, import_mode, source,
              structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
              rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
              created_at, updated_at
            )
            SELECT
              id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
              category, '', '', '', NULL, 'manual_save', COALESCE(source_id, ''),
              structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
              rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
              created_at, updated_at
            FROM molecules;
            DROP TABLE molecules;
            ALTER TABLE molecules_new RENAME TO molecules;
            PRAGMA foreign_keys = ON;
            "#,
        )
        .map_err(|err| format!("Failed to migrate molecules table: {err}"))?;
    Ok(())
}

fn create_indexes(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_molecule_descriptors_molecule_id ON molecule_descriptors(molecule_id);
            CREATE INDEX IF NOT EXISTS idx_molecule_descriptors_set_status ON molecule_descriptors(descriptor_set, status);
            CREATE INDEX IF NOT EXISTS idx_molecules_inchi_key ON molecules(inchi_key);
            CREATE INDEX IF NOT EXISTS idx_molecules_smiles_canonical ON molecules(smiles_canonical);
            CREATE INDEX IF NOT EXISTS idx_molecules_duplicate_of ON molecules(duplicate_of);
            "#,
        )
        .map_err(|err| format!("Failed to initialize SQLite indexes: {err}"))?;
    Ok(())
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| format!("Failed to inspect {table} columns: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("Failed to read {table} columns: {err}"))?;
    for row in rows {
        if row.map_err(|err| format!("Failed to read {table} column: {err}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn create_workspace_directories(workspace: &std::path::Path) -> Result<(), String> {
    for relative in [
        "",
        "files/imports",
        "files/structures",
        "files/curves",
        "files/wear_images",
        "files/pdsc",
        "files/reports",
        "files/models",
        "exports",
        "backups",
    ] {
        fs::create_dir_all(workspace.join(relative))
            .map_err(|err| format!("Failed to create workspace folder {relative}: {err}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn create_workspace_directories_creates_expected_folders() {
        let root = std::env::temp_dir().join(format!("lmd-test-{}", Uuid::new_v4()));
        create_workspace_directories(&root).expect("workspace directories should be created");

        assert!(root.join("files/imports").is_dir());
        assert!(root.join("files/structures").is_dir());
        assert!(root.join("exports").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn column_exists_returns_true_for_known_column() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute("CREATE TABLE demo (id TEXT PRIMARY KEY, name TEXT)", [])
            .expect("demo table should be created");

        assert!(column_exists(&connection, "demo", "name").expect("column check should work"));
    }

    #[test]
    fn column_exists_returns_false_for_unknown_column() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute("CREATE TABLE demo (id TEXT PRIMARY KEY, name TEXT)", [])
            .expect("demo table should be created");

        assert!(!column_exists(&connection, "demo", "missing").expect("column check should work"));
    }
}
