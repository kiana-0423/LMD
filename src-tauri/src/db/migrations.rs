use crate::app_paths::default_workspace_dir;
use crate::db::open_database;
use crate::db::schema::INIT_SCHEMA_SQL;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

const LATEST_SCHEMA_VERSION: i64 = 10;

pub fn initialize_database_file(app: &AppHandle) -> Result<(), String> {
    let workspace = default_workspace_dir(app)?;
    initialize_database_at(&workspace)
}

pub fn initialize_database_at(workspace: &Path) -> Result<(), String> {
    create_workspace_directories(workspace)?;
    let db_path = workspace.join("lmd.sqlite");
    let already_existed = db_path.is_file();
    let connection =
        open_database(&db_path).map_err(|err| format!("Failed to open SQLite database: {err}"))?;
    connection
        .execute_batch(INIT_SCHEMA_SQL)
        .map_err(|err| format!("Failed to initialize SQLite schema: {err}"))?;

    // A structural migration is the one operation that can leave a workspace unopenable by the
    // build that wrote it. Taking a verified snapshot first is what makes it survivable — and it
    // is skipped for a workspace that has nothing in it yet, where there is nothing to lose and a
    // backup would only be noise in the folder.
    let stored_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|err| format!("Failed to read SQLite schema version: {err}"))?;
    if already_existed
        && stored_version < LATEST_SCHEMA_VERSION
        && workspace_holds_records(&connection)?
    {
        let timestamp = chrono::Utc::now().to_rfc3339();
        crate::commands::backup::backup_before_migration(workspace, &db_path, &timestamp)?;
    }

    apply_migrations(&connection)?;
    Ok(())
}

/// True when the workspace holds anything a user would mind losing.
fn workspace_holds_records(connection: &Connection) -> Result<bool, String> {
    let total: i64 = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM molecules)
                  + (SELECT COUNT(*) FROM formulations)
                  + (SELECT COUNT(*) FROM experiments)
                  + (SELECT COUNT(*) FROM base_oils)
                  + (SELECT COUNT(*) FROM additives)
                  + (SELECT COUNT(*) FROM commercial_products)",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to look for existing records: {err}"))?;
    Ok(total > 0)
}

fn apply_migrations(connection: &Connection) -> Result<(), String> {
    let mut version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|err| format!("Failed to read SQLite schema version: {err}"))?;

    if version < 1 {
        migrate_molecules_table(connection)?;
        set_schema_version(connection, 1)?;
        version = 1;
    }
    if version < 2 {
        create_indexes(connection)?;
        set_schema_version(connection, 2)?;
        version = 2;
    }
    if version < 3 {
        create_model_tables(connection)?;
        set_schema_version(connection, 3)?;
        version = 3;
    }
    if version < 4 {
        add_model_provenance_columns(connection)?;
        set_schema_version(connection, 4)?;
        version = 4;
    }
    if version < 5 {
        add_model_feature_schema_columns(connection)?;
        set_schema_version(connection, 5)?;
        version = 5;
    }
    if version < 6 {
        create_relationship_indexes(connection)?;
        enforce_scientific_constraints(connection)?;
        set_schema_version(connection, 6)?;
        version = 6;
    }
    if version < 7 {
        create_design_tables(connection)?;
        set_schema_version(connection, 7)?;
        version = 7;
    }
    if version < 8 {
        for (table, column, kind) in [
            ("experiments", "test_parameters_json", "TEXT"),
            (
                "performance_results",
                "initial_decomposition_temperature_value",
                "REAL",
            ),
        ] {
            if !column_exists(connection, table, column)? {
                connection
                    .execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {kind}"))
                    .map_err(|err| format!("Failed to add test-specific field: {err}"))?;
            }
        }
        set_schema_version(connection, 8)?;
        version = 8;
    }
    if version < 9 {
        add_commercial_products(connection)?;
        set_schema_version(connection, 9)?;
        version = 9;
    }
    if version < 10 {
        if !column_exists(
            connection,
            "commercial_products",
            "material_properties_json",
        )? {
            connection.execute_batch("ALTER TABLE commercial_products ADD COLUMN material_properties_json TEXT NOT NULL DEFAULT '{}';")
                .map_err(|err| format!("Failed to add commercial material properties: {err}"))?;
        }
        set_schema_version(connection, 10)?;
        version = 10;
    }
    if version > LATEST_SCHEMA_VERSION {
        return Err(format!(
            "Database schema version {version} is newer than this LMD build supports ({LATEST_SCHEMA_VERSION})."
        ));
    }
    Ok(())
}

/// Rebuild only the additive table to allow a commercial source without inventing a molecule.
/// Foreign keys are suspended outside the transaction, checked before commit, then restored.
fn add_commercial_products(connection: &Connection) -> Result<(), String> {
    let start = INIT_SCHEMA_SQL
        .find("CREATE TABLE IF NOT EXISTS commercial_products")
        .ok_or("schema.rs no longer defines commercial_products")?;
    let end = INIT_SCHEMA_SQL
        .find("CREATE TABLE IF NOT EXISTS base_oils")
        .ok_or("schema.rs no longer defines base_oils")?;
    connection
        .pragma_update(None, "foreign_keys", false)
        .map_err(|err| err.to_string())?;
    let result = (|| -> Result<(), String> {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|err| err.to_string())?;
        transaction
            .execute_batch(&INIT_SCHEMA_SQL[start..end])
            .map_err(|err| err.to_string())?;
        if !column_exists(&transaction, "base_oils", "commercial_product_id")? {
            transaction.execute_batch("ALTER TABLE base_oils ADD COLUMN commercial_product_id TEXT REFERENCES commercial_products(id);")
                .map_err(|err| err.to_string())?;
        }
        if !column_exists(&transaction, "additives", "commercial_product_id")? {
            // Preserve legacy values, including values flagged by the existing quality audit.
            // The audit's triggers continue enforcing those rules for subsequent writes.
            transaction.execute_batch("CREATE TABLE additives_products_new (
                id TEXT PRIMARY KEY, molecule_id TEXT,
                commercial_product_id TEXT REFERENCES commercial_products(id),
                function_types TEXT, active_elements TEXT, typical_concentration_min REAL,
                typical_concentration_max REAL, concentration_unit TEXT, compatible_base_oils TEXT,
                application_notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY (molecule_id) REFERENCES molecules(id));
                INSERT INTO additives_products_new (id, molecule_id, function_types, active_elements,
                    typical_concentration_min, typical_concentration_max, concentration_unit,
                    compatible_base_oils, application_notes, created_at, updated_at)
                SELECT id, molecule_id, function_types, active_elements,
                    typical_concentration_min, typical_concentration_max, concentration_unit,
                    compatible_base_oils, application_notes, created_at, updated_at FROM additives;
                DROP TABLE additives;
                ALTER TABLE additives_products_new RENAME TO additives;")
                .map_err(|err| err.to_string())?;
        }
        transaction.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS idx_base_oils_commercial_product ON base_oils(commercial_product_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_additives_commercial_product ON additives(commercial_product_id);")
            .map_err(|err| err.to_string())?;
        for event in ["INSERT", "UPDATE"] {
            transaction.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS additive_source_{event}
                BEFORE {event} ON additives
                WHEN ((CASE WHEN NEW.molecule_id IS NOT NULL AND NEW.molecule_id <> '' THEN 1 ELSE 0 END)
                    + (CASE WHEN NEW.commercial_product_id IS NOT NULL THEN 1 ELSE 0 END)) <> 1
                BEGIN SELECT RAISE(ABORT, 'An additive needs exactly one molecule or commercial product source'); END;"))
                .map_err(|err| err.to_string())?;
        }
        create_relationship_indexes(&transaction)?;
        enforce_scientific_constraints(&transaction)?;
        check_foreign_keys(&transaction)?;
        transaction.commit().map_err(|err| err.to_string())
    })();
    let restore = connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|err| err.to_string());
    result?;
    restore
}

fn set_schema_version(connection: &Connection, version: i64) -> Result<(), String> {
    connection
        .pragma_update(None, "user_version", version)
        .map_err(|err| format!("Failed to update SQLite schema version: {err}"))
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

    let column = |name: &str, fallback: &str| -> Result<String, String> {
        Ok(if column_exists(connection, "molecules", name)? {
            name.to_string()
        } else {
            fallback.to_string()
        })
    };
    let source_expression = match (
        column_exists(connection, "molecules", "source")?,
        column_exists(connection, "molecules", "source_id")?,
    ) {
        (true, true) => "COALESCE(source, source_id, '')".to_string(),
        (true, false) => "COALESCE(source, '')".to_string(),
        (false, true) => "COALESCE(source_id, '')".to_string(),
        (false, false) => "''".to_string(),
    };
    let select_sql = format!(
        "INSERT INTO molecules_new (
          id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
          category, tags, molfile, descriptor_json, duplicate_of, import_mode, source,
          structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
          rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
          created_at, updated_at
        )
        SELECT
          id, name, {aliases}, {smiles_raw}, {smiles_canonical}, {inchi}, {inchi_key}, {formula}, {molecular_weight},
          {category}, {tags}, {molfile}, {descriptor_json}, {duplicate_of}, {import_mode}, {source},
          {structure_svg_path}, {mol_file_path}, {sdf_file_path}, {pdb_file_path},
          {rdkit_status}, {mordred_status}, {descriptor_ready}, {source_id}, {notes},
          {created_at}, {updated_at}
        FROM molecules",
        aliases = column("aliases", "''")?,
        smiles_raw = column("smiles_raw", "''")?,
        smiles_canonical = column("smiles_canonical", "''")?,
        inchi = column("inchi", "''")?,
        inchi_key = column("inchi_key", "''")?,
        formula = column("formula", "''")?,
        molecular_weight = column("molecular_weight", "NULL")?,
        category = column("category", "'candidate'")?,
        tags = column("tags", "'[]'")?,
        molfile = column("molfile", "''")?,
        descriptor_json = column("descriptor_json", "'{}'")?,
        duplicate_of = column("duplicate_of", "NULL")?,
        import_mode = column("import_mode", "'manual_save'")?,
        source = source_expression,
        structure_svg_path = column("structure_svg_path", "''")?,
        mol_file_path = column("mol_file_path", "''")?,
        sdf_file_path = column("sdf_file_path", "''")?,
        pdb_file_path = column("pdb_file_path", "''")?,
        rdkit_status = column("rdkit_descriptor_status", "'pending'")?,
        mordred_status = column("mordred_descriptor_status", "'pending'")?,
        descriptor_ready = column("descriptor_ready", "0")?,
        source_id = column("source_id", "''")?,
        notes = column("notes", "''")?,
        created_at = column("created_at", "CURRENT_TIMESTAMP")?,
        updated_at = column("updated_at", "CURRENT_TIMESTAMP")?,
    );

    connection
        .pragma_update(None, "foreign_keys", false)
        .map_err(|err| format!("Failed to suspend foreign keys for molecule migration: {err}"))?;
    let migration_result = (|| -> Result<(), String> {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|err| format!("Failed to start molecule migration transaction: {err}"))?;
        transaction
            .execute_batch(
                r#"
            DROP TABLE IF EXISTS molecules_new;
            CREATE TABLE molecules_new (
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
            "#,
            )
            .map_err(|err| format!("Failed to create replacement molecules table: {err}"))?;
        transaction
            .execute(&select_sql, [])
            .map_err(|err| format!("Failed to preserve molecule rows during migration: {err}"))?;
        transaction
            .execute_batch("DROP TABLE molecules; ALTER TABLE molecules_new RENAME TO molecules;")
            .map_err(|err| format!("Failed to replace molecules table: {err}"))?;
        transaction
            .commit()
            .map_err(|err| format!("Failed to commit molecule migration: {err}"))
    })();
    let foreign_key_result = connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|err| format!("Failed to restore foreign key enforcement: {err}"));
    migration_result?;
    foreign_key_result?;
    Ok(())
}

/// Adds the trained-model registry. Purely additive, so an existing workspace keeps every row.
fn create_model_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS models (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              target TEXT NOT NULL,
              task TEXT NOT NULL,
              algorithm TEXT NOT NULL,
              model_version TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              feature_order TEXT NOT NULL,
              metrics_json TEXT NOT NULL,
              sample_count INTEGER NOT NULL,
              feature_count INTEGER NOT NULL,
              trained_at TEXT NOT NULL,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_models_target ON models(target);
            CREATE INDEX IF NOT EXISTS idx_models_trained_at ON models(trained_at);
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            "#,
        )
        .map_err(|err| format!("Failed to create the model registry: {err}"))?;
    check_foreign_keys(connection)
}

/// Records how a model's dataset and validation split were built, so the provenance survives a
/// restart instead of living only in the response of the training call.
///
/// Purely additive: `ALTER TABLE ... ADD COLUMN` keeps every existing row.
fn add_model_provenance_columns(connection: &Connection) -> Result<(), String> {
    for (column, definition) in [
        ("split_method", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("dataset_mode", "TEXT NOT NULL DEFAULT 'additive_component'"),
        ("interpretation", "TEXT NOT NULL DEFAULT ''"),
        ("group_count", "INTEGER NOT NULL DEFAULT 0"),
        ("validated", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !column_exists(connection, "models", column)? {
            connection
                .execute(
                    &format!("ALTER TABLE models ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|err| format!("Failed to add models.{column}: {err}"))?;
        }
    }
    check_foreign_keys(connection)
}

/// Records the feature definition a model was trained under.
///
/// Feature names, their normalization, and the concentration basis they assume can change between
/// builds. Without this, an older model would keep predicting from columns that no longer mean
/// what they did, and the number would look exactly as trustworthy as a correct one. Existing rows
/// default to schema `1`, which this build refuses to predict with — retraining is the only honest
/// migration for a fitted model.
///
/// Purely additive: `ALTER TABLE ... ADD COLUMN` keeps every existing row.
fn add_model_feature_schema_columns(connection: &Connection) -> Result<(), String> {
    for (column, definition) in [
        ("feature_schema_version", "TEXT NOT NULL DEFAULT '1'"),
        ("concentration_basis", "TEXT NOT NULL DEFAULT 'unrecorded'"),
        ("dataset_report_json", "TEXT NOT NULL DEFAULT '{}'"),
    ] {
        if !column_exists(connection, "models", column)? {
            connection
                .execute(
                    &format!("ALTER TABLE models ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|err| format!("Failed to add models.{column}: {err}"))?;
        }
    }
    check_foreign_keys(connection)
}

/// Adds the molecular-design candidate collection and the model provenance it reads.
///
/// Purely additive. The three model columns default to "no scope", "no molecule count" and "no
/// domain recorded", which is exactly what an older model is: it can still predict, and a design
/// assessment reports its domain evidence as unavailable rather than inventing it. Candidates are
/// kept apart from `molecules` by construction — a generated structure enters the library only
/// through an explicit promotion.
fn create_design_tables(connection: &Connection) -> Result<(), String> {
    for (column, definition) in [
        ("dataset_scope_json", "TEXT NOT NULL DEFAULT '{}'"),
        ("molecule_count", "INTEGER NOT NULL DEFAULT 0"),
        ("domain_json", "TEXT NOT NULL DEFAULT '{}'"),
    ] {
        if !column_exists(connection, "models", column)? {
            connection
                .execute(
                    &format!("ALTER TABLE models ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|err| format!("Failed to add models.{column}: {err}"))?;
        }
    }
    // The table definitions are the ones in schema.rs, so a fresh and a migrated workspace carry
    // the same shape; `CREATE TABLE IF NOT EXISTS` makes this a no-op where they already exist.
    let start = INIT_SCHEMA_SQL
        .find("CREATE TABLE IF NOT EXISTS design_candidates")
        .ok_or("schema.rs no longer defines design_candidates")?;
    let end = INIT_SCHEMA_SQL
        .find("CREATE TABLE IF NOT EXISTS settings")
        .ok_or("schema.rs no longer defines settings")?;
    connection
        .execute_batch(&INIT_SCHEMA_SQL[start..end])
        .map_err(|err| format!("Failed to create the design candidate tables: {err}"))?;
    check_foreign_keys(connection)
}

/// The indexes every list and every lookup in the application depends on.
///
/// Without them SQLite scans the whole table for each of these: the formulation list touches
/// `formulation_components` once per formulation, the base-oil list once per oil, and an
/// attachment lookup scans every attachment in the workspace. They are cheap, they are additive,
/// and `IF NOT EXISTS` makes re-running the migration a no-op.
fn create_relationship_indexes(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_formulation_components_formulation_id
              ON formulation_components(formulation_id);
            CREATE INDEX IF NOT EXISTS idx_formulation_components_molecule_id
              ON formulation_components(molecule_id);
            CREATE INDEX IF NOT EXISTS idx_formulation_components_base_oil_id
              ON formulation_components(base_oil_id);
            CREATE INDEX IF NOT EXISTS idx_formulation_components_additive_id
              ON formulation_components(additive_id);
            CREATE INDEX IF NOT EXISTS idx_experiments_formulation_id
              ON experiments(formulation_id);
            CREATE INDEX IF NOT EXISTS idx_performance_results_experiment_id
              ON performance_results(experiment_id);
            CREATE INDEX IF NOT EXISTS idx_attachments_linked_entity
              ON attachments(linked_entity_type, linked_entity_id);

            -- Stable-sort indexes. Every paginated list orders by `created_at DESC, id DESC`;
            -- query-plan inspection shows SQLite otherwise materializes and sorts the whole table
            -- before it can return the first page.
            CREATE INDEX IF NOT EXISTS idx_base_oils_created_at ON base_oils(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_additives_created_at ON additives(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_formulations_created_at ON formulations(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_performance_results_created_at
              ON performance_results(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_molecules_created_at ON molecules(created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_formulations_name ON formulations(name);
            CREATE INDEX IF NOT EXISTS idx_base_oils_name ON base_oils(name);
            CREATE INDEX IF NOT EXISTS idx_molecules_name ON molecules(name);
            "#,
        )
        .map_err(|err| format!("Failed to create relationship indexes: {err}"))
}

/// One legacy row that a new rule would have rejected.
#[derive(Debug, Clone, PartialEq)]
pub struct DataQualityIssue {
    pub table_name: String,
    pub row_id: String,
    pub rule: String,
    pub detail: String,
}

/// The rules this build enforces, and the SQL that finds rows already breaking them.
///
/// `constraint_sql` is what a *new* database carries as a `CHECK`; `violation_sql` selects the
/// rows an existing database already holds that the check would reject.
struct ScientificRule {
    table: &'static str,
    name: &'static str,
    /// The boolean expression that must hold. Used verbatim in the enforcement trigger.
    predicate: &'static str,
    /// Why a user should care, in one sentence.
    explanation: &'static str,
}

const SCIENTIFIC_RULES: &[ScientificRule] = &[
    ScientificRule {
        table: "formulations",
        name: "formulation_name_is_not_blank",
        predicate: "length(trim(NEW.name)) > 0",
        explanation: "A formulation must have a name.",
    },
    ScientificRule {
        table: "formulations",
        name: "formulation_preparation_time_is_not_negative",
        predicate: "NEW.preparation_time IS NULL OR NEW.preparation_time >= 0",
        explanation: "A preparation time cannot be negative.",
    },
    ScientificRule {
        table: "base_oils",
        name: "base_oil_name_is_not_blank",
        predicate: "length(trim(NEW.name)) > 0",
        explanation: "A base oil must have a name.",
    },
    ScientificRule {
        table: "additives",
        name: "additive_typical_range_is_ordered",
        predicate: "NEW.typical_concentration_min IS NULL \
                    OR NEW.typical_concentration_max IS NULL \
                    OR NEW.typical_concentration_min <= NEW.typical_concentration_max",
        explanation: "A typical concentration minimum cannot exceed its maximum.",
    },
    ScientificRule {
        table: "formulation_components",
        name: "component_role_is_known",
        predicate: "NEW.component_role IN ('base_oil', 'additive', 'solvent', 'other')",
        explanation: "A component role must be one the application understands.",
    },
    ScientificRule {
        table: "formulation_components",
        name: "component_references_exactly_one_entity",
        predicate: "(CASE WHEN NEW.molecule_id IS NOT NULL AND NEW.molecule_id <> '' THEN 1 ELSE 0 END) \
                    + (CASE WHEN NEW.base_oil_id IS NOT NULL AND NEW.base_oil_id <> '' THEN 1 ELSE 0 END) \
                    + (CASE WHEN NEW.additive_id IS NOT NULL AND NEW.additive_id <> '' THEN 1 ELSE 0 END) = 1",
        explanation: "A component must reference exactly one base oil, additive, or molecule.",
    },
    ScientificRule {
        table: "formulation_components",
        name: "component_concentration_is_positive",
        predicate: "NEW.concentration_value IS NULL OR NEW.concentration_value > 0",
        explanation: "A recorded concentration must be greater than zero.",
    },
    ScientificRule {
        table: "formulation_components",
        name: "component_standard_concentration_is_positive",
        predicate: "NEW.concentration_standard_value IS NULL OR NEW.concentration_standard_value > 0",
        explanation: "A standardized concentration must be greater than zero.",
    },
    ScientificRule {
        table: "performance_results",
        name: "result_repeat_count_is_at_least_one",
        predicate: "NEW.repeat_count IS NULL OR NEW.repeat_count >= 1",
        explanation: "A repeat count must be at least one.",
    },
];

/// Installs the scientific rules on an existing workspace.
///
/// A `CHECK` constraint cannot be added to an existing SQLite table without rebuilding it, and a
/// rebuild would refuse to load any row that already breaks the rule — which is exactly the data a
/// migration must not throw away. So the rules are installed as `BEFORE INSERT`/`BEFORE UPDATE`
/// triggers instead. They are semantically identical to the `CHECK`s a freshly created database
/// carries, and they apply to every future write, but they never inspect a row that is already
/// stored.
///
/// Rows that already break a rule are preserved untouched and recorded in `data_quality_issues`,
/// so the workspace can report them as needing attention rather than silently correcting values
/// nobody measured.
fn enforce_scientific_constraints(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS data_quality_issues (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              table_name TEXT NOT NULL,
              row_id TEXT NOT NULL,
              rule TEXT NOT NULL,
              detail TEXT NOT NULL,
              detected_at TEXT NOT NULL,
              UNIQUE (table_name, row_id, rule)
            );
            "#,
        )
        .map_err(|err| format!("Failed to create the data-quality report table: {err}"))?;

    let detected_at = "migration-6";
    for rule in SCIENTIFIC_RULES {
        // The predicate is written against `NEW`; the same expression selects existing rows once
        // the alias is pointed at the table itself.
        let row_predicate = rule.predicate.replace("NEW.", &format!("{}.", rule.table));
        let violation_sql = format!(
            "SELECT id FROM {table} WHERE NOT ({row_predicate})",
            table = rule.table
        );
        let mut statement = connection
            .prepare(&violation_sql)
            .map_err(|err| format!("Failed to prepare the {} check: {err}", rule.name))?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| format!("Failed to scan {} for {}: {err}", rule.table, rule.name))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("Failed to read a {} row: {err}", rule.table))?;
        drop(statement);

        for id in ids {
            connection
                .execute(
                    "INSERT OR IGNORE INTO data_quality_issues
                       (table_name, row_id, rule, detail, detected_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![rule.table, id, rule.name, rule.explanation, detected_at],
                )
                .map_err(|err| format!("Failed to record a data-quality issue: {err}"))?;
        }

        for event in ["INSERT", "UPDATE"] {
            let trigger = format!("enforce_{}_{}", rule.name, event.to_lowercase());
            connection
                .execute_batch(&format!(
                    "DROP TRIGGER IF EXISTS {trigger};
                     CREATE TRIGGER {trigger} BEFORE {event} ON {table}
                     FOR EACH ROW WHEN NOT ({predicate})
                     BEGIN SELECT RAISE(ABORT, '{explanation}'); END;",
                    table = rule.table,
                    predicate = rule.predicate,
                    // The explanations are literals in this file and contain no quotes; a quote
                    // would break the trigger definition, so it is asserted rather than escaped.
                    explanation = rule.explanation,
                ))
                .map_err(|err| format!("Failed to install the {} rule: {err}", rule.name))?;
        }
    }
    check_foreign_keys(connection)
}

/// Every legacy row a rule would have rejected, preserved rather than corrected.
pub fn data_quality_issues(connection: &Connection) -> Result<Vec<DataQualityIssue>, String> {
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'data_quality_issues'",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to look for the data-quality report: {err}"))?;
    if exists == 0 {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT table_name, row_id, rule, detail FROM data_quality_issues
             ORDER BY table_name, rule, row_id",
        )
        .map_err(|err| format!("Failed to prepare the data-quality query: {err}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(DataQualityIssue {
                table_name: row.get(0)?,
                row_id: row.get(1)?,
                rule: row.get(2)?,
                detail: row.get(3)?,
            })
        })
        .map_err(|err| format!("Failed to read data-quality issues: {err}"))?;
    let mut issues = Vec::new();
    for row in rows {
        issues.push(row.map_err(|err| format!("Failed to read a data-quality row: {err}"))?);
    }
    Ok(issues)
}

/// A structural change must not leave dangling references behind.
fn check_foreign_keys(connection: &Connection) -> Result<(), String> {
    let violations: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|err| format!("Failed to run foreign_key_check after migration: {err}"))?;
    if violations > 0 {
        return Err(format!(
            "Migration left {violations} foreign key violation(s); the workspace was not modified further."
        ));
    }
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

    #[test]
    fn legacy_molecule_migration_preserves_existing_user_data() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(
                r#"
                CREATE TABLE molecules (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  aliases TEXT,
                  smiles_raw TEXT,
                  smiles_canonical TEXT,
                  inchi TEXT,
                  inchi_key TEXT UNIQUE,
                  formula TEXT,
                  molecular_weight REAL,
                  category TEXT,
                  tags TEXT,
                  molfile TEXT,
                  descriptor_json TEXT,
                  source_id TEXT,
                  notes TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                INSERT INTO molecules VALUES (
                  'm-1', 'Ethanol', 'ethyl alcohol', 'CCO', 'CCO', 'inchi', 'key', 'C2H6O', 46.069,
                  'solvent', '["polar"]', 'MOL BLOCK', '{"MolWt":46.069}', 'paper-1', 'keep me',
                  '2026-01-01', '2026-01-02'
                );
                "#,
            )
            .expect("legacy schema should be created");

        migrate_molecules_table(&connection).expect("migration should succeed");

        let preserved: (String, String, String, String, String) = connection
            .query_row(
                "SELECT tags, molfile, descriptor_json, source, notes FROM molecules WHERE id = 'm-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("migrated molecule should exist");
        assert_eq!(preserved.0, "[\"polar\"]");
        assert_eq!(preserved.1, "MOL BLOCK");
        assert_eq!(preserved.2, "{\"MolWt\":46.069}");
        assert_eq!(preserved.3, "paper-1");
        assert_eq!(preserved.4, "keep me");
        assert!(column_exists(&connection, "molecules", "duplicate_of")
            .expect("new column should be inspectable"));
    }

    #[test]
    fn migrations_record_the_latest_schema_version() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("current schema should initialize");

        apply_migrations(&connection).expect("migrations should succeed");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");
        assert_eq!(version, LATEST_SCHEMA_VERSION);
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;

    /// A database created by an older build: schema version 0, no model registry, real user rows.
    fn legacy_workspace() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("base schema should initialize");
        connection
            .execute_batch("DROP TABLE models;")
            .expect("legacy databases have no model registry");
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, tags, molfile, created_at, updated_at)
                  VALUES ('mol-legacy', 'Legacy Ester', '["antiwear"]', 'MOL BLOCK',
                          '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('form-legacy', 'Legacy Formulation', '2026-01-01', '2026-01-01');
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('exp-legacy', 'form-legacy', '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("legacy rows should insert");
        connection
            .pragma_update(None, "user_version", 0)
            .expect("legacy version should be set");
        connection
    }

    #[test]
    fn upgrading_a_legacy_workspace_adds_the_model_registry_without_touching_user_rows() {
        let connection = legacy_workspace();

        apply_migrations(&connection).expect("migrations should succeed");

        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version should be readable");
        assert_eq!(version, LATEST_SCHEMA_VERSION);

        let (name, tags, molfile): (String, String, String) = connection
            .query_row(
                "SELECT name, tags, molfile FROM molecules WHERE id = 'mol-legacy'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the legacy molecule should survive");
        assert_eq!(name, "Legacy Ester");
        assert_eq!(tags, "[\"antiwear\"]");
        assert_eq!(molfile, "MOL BLOCK");

        let models: i64 = connection
            .query_row("SELECT COUNT(*) FROM models", [], |row| row.get(0))
            .expect("the model registry should now exist");
        assert_eq!(models, 0);
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let connection = legacy_workspace();
        apply_migrations(&connection).expect("first run should succeed");
        apply_migrations(&connection).expect("second run should be a no-op");

        let experiments: i64 = connection
            .query_row("SELECT COUNT(*) FROM experiments", [], |row| row.get(0))
            .expect("experiments should still be readable");
        assert_eq!(experiments, 1);
    }

    #[test]
    fn a_database_from_a_newer_build_is_refused_rather_than_downgraded() {
        let connection = legacy_workspace();
        connection
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 5)
            .expect("version should be set");

        let error = apply_migrations(&connection).expect_err("a newer schema must be refused");

        assert!(error.contains("newer than this LMD build supports"));
    }

    #[test]
    fn structural_migration_leaves_no_foreign_key_violations() {
        let connection = legacy_workspace();
        apply_migrations(&connection).expect("migrations should succeed");

        let violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("the integrity check should run");
        assert_eq!(violations, 0);
    }
}

#[cfg(test)]
mod constraint_migration_tests {
    use super::*;

    /// A workspace as an older build left it: no `CHECK` constraints, and rows an older reader
    /// happily wrote.
    fn workspace_without_constraints() -> Connection {
        let connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(
                r#"
                CREATE TABLE molecules (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT, smiles_raw TEXT,
                  smiles_canonical TEXT, inchi TEXT, inchi_key TEXT, formula TEXT,
                  molecular_weight REAL, category TEXT, tags TEXT, molfile TEXT,
                  descriptor_json TEXT, duplicate_of TEXT, import_mode TEXT, source TEXT,
                  structure_svg_path TEXT, mol_file_path TEXT, sdf_file_path TEXT,
                  pdb_file_path TEXT, rdkit_descriptor_status TEXT, mordred_descriptor_status TEXT,
                  descriptor_ready INTEGER DEFAULT 0, source_id TEXT, notes TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE molecule_descriptors (
                  id TEXT PRIMARY KEY, molecule_id TEXT NOT NULL, descriptor_set TEXT NOT NULL,
                  descriptor_version TEXT, descriptors_json TEXT NOT NULL, descriptor_count INTEGER,
                  status TEXT NOT NULL, mode TEXT, error_message TEXT, calculated_at TEXT
                );
                CREATE TABLE base_oils (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_oil_type TEXT,
                  representative_molecule_id TEXT, viscosity_40c REAL, viscosity_100c REAL,
                  viscosity_index REAL, density REAL, pour_point REAL, flash_point REAL,
                  supplier TEXT, batch_number TEXT, notes TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE additives (
                  id TEXT PRIMARY KEY, molecule_id TEXT NOT NULL, function_types TEXT,
                  active_elements TEXT, typical_concentration_min REAL,
                  typical_concentration_max REAL, concentration_unit TEXT,
                  compatible_base_oils TEXT, application_notes TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE formulations (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, preparation_method TEXT,
                  preparation_temperature REAL, preparation_temperature_unit TEXT,
                  preparation_time REAL, preparation_time_unit TEXT, stability_observation TEXT,
                  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE formulation_components (
                  id TEXT PRIMARY KEY, formulation_id TEXT NOT NULL, component_role TEXT NOT NULL,
                  molecule_id TEXT, base_oil_id TEXT, additive_id TEXT, concentration_value REAL,
                  concentration_unit TEXT, concentration_standard_value REAL,
                  concentration_standard_unit TEXT, notes TEXT
                );
                CREATE TABLE experiments (
                  id TEXT PRIMARY KEY, formulation_id TEXT NOT NULL, test_type TEXT,
                  test_standard TEXT, instrument TEXT, upper_material TEXT, lower_material TEXT,
                  load_value REAL, load_unit TEXT, temperature_value REAL, temperature_unit TEXT,
                  duration_value REAL, duration_unit TEXT, operator TEXT, experiment_date TEXT,
                  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE performance_results (
                  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL,
                  average_friction_coefficient REAL, stable_friction_coefficient REAL,
                  wear_scar_width_value REAL, wear_scar_diameter_value REAL,
                  initial_oxidation_temperature_value REAL, extreme_pressure_value REAL,
                  pb_value REAL, pd_value REAL, viscosity_40c REAL, viscosity_100c REAL,
                  repeat_count INTEGER, std_json TEXT, raw_result_json TEXT, notes TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE attachments (
                  id TEXT PRIMARY KEY, linked_entity_type TEXT NOT NULL,
                  linked_entity_id TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT,
                  relative_path TEXT NOT NULL, description TEXT, uploaded_at TEXT NOT NULL
                );
                CREATE TABLE data_sources (
                  id TEXT PRIMARY KEY, source_type TEXT, title TEXT, authors TEXT, journal TEXT,
                  year INTEGER, doi TEXT, url TEXT, notes TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE jobs (
                  id TEXT PRIMARY KEY, job_type TEXT NOT NULL, status TEXT NOT NULL, progress REAL,
                  total_count INTEGER, success_count INTEGER, failed_count INTEGER,
                  input_json TEXT, output_json TEXT, error_message TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);

                INSERT INTO molecules (id, name, created_at, updated_at)
                  VALUES ('m-1', 'ZDDP', '2026-01-01', '2026-01-01');
                INSERT INTO base_oils (id, name, created_at, updated_at)
                  VALUES ('bo-1', 'PAO 6', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, preparation_time, created_at, updated_at)
                  VALUES ('f-ok', 'Good Blend', 30, '2026-01-01', '2026-01-01'),
                         ('f-bad', 'Legacy Blend', -4, '2026-01-01', '2026-01-01');
                -- A component that references nothing at all, and one at zero concentration.
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, base_oil_id, concentration_value)
                  VALUES ('c-ok', 'f-ok', 'base_oil', 'bo-1', 99.0),
                         ('c-orphan', 'f-bad', 'base_oil', NULL, 99.0),
                         ('c-zero', 'f-bad', 'additive', 'bo-1', 0.0);
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('e-1', 'f-ok', '2026-01-01', '2026-01-01');
                INSERT INTO performance_results (id, experiment_id, repeat_count, created_at, updated_at)
                  VALUES ('r-1', 'e-1', 0, '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("legacy workspace should be created");
        connection
    }

    #[test]
    fn every_legacy_row_survives_the_constraint_migration() {
        let connection = workspace_without_constraints();

        apply_migrations(&connection).expect("migrations should succeed");

        // Not one row was corrected, deleted, or rewritten.
        let (components, formulations, results): (i64, i64, i64) = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM formulation_components),
                        (SELECT COUNT(*) FROM formulations),
                        (SELECT COUNT(*) FROM performance_results)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("counts should read");
        assert_eq!((components, formulations, results), (3, 2, 1));

        let legacy_time: f64 = connection
            .query_row(
                "SELECT preparation_time FROM formulations WHERE id = 'f-bad'",
                [],
                |row| row.get(0),
            )
            .expect("the legacy value should still be there");
        assert_eq!(
            legacy_time, -4.0,
            "a scientifically invalid legacy value is preserved, not silently corrected"
        );
    }

    #[test]
    fn legacy_rows_that_break_a_new_rule_are_reported_as_needing_attention() {
        let connection = workspace_without_constraints();
        apply_migrations(&connection).expect("migrations should succeed");

        let issues = data_quality_issues(&connection).expect("issues should read");
        let reported: Vec<(String, String)> = issues
            .iter()
            .map(|issue| (issue.row_id.clone(), issue.rule.clone()))
            .collect();

        assert!(reported.contains(&(
            "f-bad".to_string(),
            "formulation_preparation_time_is_not_negative".to_string()
        )));
        assert!(reported.contains(&(
            "c-orphan".to_string(),
            "component_references_exactly_one_entity".to_string()
        )));
        assert!(reported.contains(&(
            "c-zero".to_string(),
            "component_concentration_is_positive".to_string()
        )));
        assert!(reported.contains(&(
            "r-1".to_string(),
            "result_repeat_count_is_at_least_one".to_string()
        )));
        // The rows that were always fine are not reported.
        assert!(!reported.iter().any(|(id, _)| id == "c-ok" || id == "f-ok"));
    }

    #[test]
    fn the_rules_apply_to_every_write_made_after_the_migration() {
        let connection = workspace_without_constraints();
        apply_migrations(&connection).expect("migrations should succeed");

        for (label, sql) in [
            (
                "a component referencing nothing",
                "INSERT INTO formulation_components (id, formulation_id, component_role)
                 VALUES ('new-1', 'f-ok', 'base_oil')",
            ),
            (
                "a component referencing two entities",
                "INSERT INTO formulation_components
                   (id, formulation_id, component_role, base_oil_id, molecule_id)
                 VALUES ('new-2', 'f-ok', 'base_oil', 'bo-1', 'm-1')",
            ),
            (
                "a zero concentration",
                "INSERT INTO formulation_components
                   (id, formulation_id, component_role, base_oil_id, concentration_value)
                 VALUES ('new-3', 'f-ok', 'base_oil', 'bo-1', 0)",
            ),
            (
                "an unknown role",
                "INSERT INTO formulation_components
                   (id, formulation_id, component_role, base_oil_id)
                 VALUES ('new-4', 'f-ok', 'catalyst', 'bo-1')",
            ),
            (
                "a negative preparation time",
                "INSERT INTO formulations (id, name, preparation_time, created_at, updated_at)
                 VALUES ('new-5', 'Backwards', -1, '2026-02-01', '2026-02-01')",
            ),
            (
                "a blank formulation name",
                "INSERT INTO formulations (id, name, created_at, updated_at)
                 VALUES ('new-6', '   ', '2026-02-01', '2026-02-01')",
            ),
            (
                "a repeat count below one",
                "INSERT INTO performance_results (id, experiment_id, repeat_count, created_at, updated_at)
                 VALUES ('new-7', 'e-1', 0, '2026-02-01', '2026-02-01')",
            ),
            (
                "an inverted typical range",
                "INSERT INTO additives
                   (id, molecule_id, typical_concentration_min, typical_concentration_max,
                    created_at, updated_at)
                 VALUES ('new-8', 'm-1', 5, 1, '2026-02-01', '2026-02-01')",
            ),
        ] {
            assert!(
                connection.execute(sql, []).is_err(),
                "{label} should be refused after the migration"
            );
        }

        // And an update that would break a rule is refused just as an insert is.
        assert!(connection
            .execute(
                "UPDATE formulation_components SET concentration_value = 0 WHERE id = 'c-ok'",
                []
            )
            .is_err());
    }

    #[test]
    fn a_valid_write_still_succeeds_after_the_migration() {
        let connection = workspace_without_constraints();
        apply_migrations(&connection).expect("migrations should succeed");

        connection
            .execute(
                "INSERT INTO formulation_components
                   (id, formulation_id, component_role, additive_id, concentration_value,
                    concentration_unit)
                 VALUES ('good-1', 'f-ok', 'additive', 'ad-new', 1.5, 'wt%')",
                [],
            )
            .expect("a well-formed component is still accepted");
    }

    #[test]
    fn the_relationship_indexes_exist_after_the_migration() {
        let connection = workspace_without_constraints();
        apply_migrations(&connection).expect("migrations should succeed");

        for index in [
            "idx_formulation_components_formulation_id",
            "idx_formulation_components_molecule_id",
            "idx_formulation_components_base_oil_id",
            "idx_formulation_components_additive_id",
            "idx_experiments_formulation_id",
            "idx_performance_results_experiment_id",
            "idx_attachments_linked_entity",
        ] {
            let found: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    rusqlite::params![index],
                    |row| row.get(0),
                )
                .expect("the index lookup should run");
            assert_eq!(found, 1, "{index} should exist");
        }
    }

    #[test]
    fn a_fresh_database_carries_the_same_rules_as_a_migrated_one() {
        let connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        apply_migrations(&connection).expect("migrations should succeed");

        // The CHECK constraint in the fresh schema, not the trigger, is what refuses this.
        assert!(connection
            .execute(
                "INSERT INTO formulations (id, name, preparation_time, created_at, updated_at)
                 VALUES ('f-1', 'Backwards', -1, '2026-02-01', '2026-02-01')",
                []
            )
            .is_err());
        assert!(data_quality_issues(&connection)
            .expect("issues should read")
            .is_empty());
    }

    #[test]
    fn upgrading_from_every_released_schema_version_reaches_the_current_one() {
        for from_version in 0..=6 {
            let connection = workspace_without_constraints();
            connection
                .pragma_update(None, "user_version", from_version)
                .expect("version should be set");
            // Versions 3 and above already have the model registry.
            if from_version >= 3 {
                create_model_tables(&connection).expect("model registry should exist");
            }
            if from_version >= 4 {
                add_model_provenance_columns(&connection).expect("provenance columns should exist");
            }
            if from_version >= 5 {
                add_model_feature_schema_columns(&connection).expect("schema columns should exist");
            }

            apply_migrations(&connection)
                .unwrap_or_else(|err| panic!("upgrading from {from_version} failed: {err}"));

            let version: i64 = connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .expect("version should read");
            assert_eq!(version, LATEST_SCHEMA_VERSION, "from {from_version}");
            let formulations: i64 = connection
                .query_row("SELECT COUNT(*) FROM formulations", [], |row| row.get(0))
                .expect("count should read");
            assert_eq!(formulations, 2, "no user data is lost from {from_version}");
        }
    }
}
