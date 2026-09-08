use lubricant_materials_database::{
    commands::{
        base_additive::ADDITIVE_SELECT,
        commercial_product::{
            delete_product, get_product, list_products, register_product, save_product,
            ProductWrite,
        },
        model::{aggregate_feature_agreement, dataset_summary},
        pagination::PageRequest,
    },
    db::{configure_connection, migrations::initialize_database_at, schema::INIT_SCHEMA_SQL},
};
use rusqlite::{params, Connection};

fn database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    configure_connection(&connection).unwrap();
    connection.execute_batch(INIT_SCHEMA_SQL).unwrap();
    connection
}
fn product(batch: &str) -> ProductWrite {
    ProductWrite {
        name: "Commercial AW-1".into(),
        manufacturer: "Example manufacturer".into(),
        production_date: "2026-09-01".into(),
        batch_number: batch.into(),
        product_number: "00042".into(),
        general_formula: "R–S–R".into(),
        category: "additive".into(),
        ..Default::default()
    }
}

#[test]
fn products_round_trip_without_structures_and_keep_batches_distinct() {
    let connection = database();
    let first = save_product(&connection, None, product("001")).unwrap();
    let second = save_product(&connection, None, product("002")).unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(
        get_product(&connection, &first.id)
            .unwrap()
            .data
            .product_number,
        "00042"
    );
    let page = list_products(
        &connection,
        PageRequest {
            search: Some("001".into()),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, first.id);
    let mut edited = product("001");
    edited.general_formula.clear();
    edited.manufacturer = "Revised manufacturer".into();
    let saved = save_product(&connection, Some(&first.id), edited).unwrap();
    assert_eq!(saved.data.general_formula, "");
    assert_eq!(saved.created_at, first.created_at);
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM molecules", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    delete_product(&connection, &second.id).unwrap();
    assert!(get_product(&connection, &second.id).is_err());
}

#[test]
fn validates_dates_names_and_literal_search() {
    let connection = database();
    let mut invalid = product("x");
    invalid.production_date = "2026-02-30".into();
    assert!(save_product(&connection, None, invalid)
        .unwrap_err()
        .contains("product.invalidDate"));
    assert!(save_product(&connection, None, ProductWrite::default()).is_err());
    save_product(&connection, None, product("100%")).unwrap();
    save_product(&connection, None, product("1000")).unwrap();
    let page = list_products(
        &connection,
        PageRequest {
            search: Some("100%".into()),
            page_size: Some(1),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].data.batch_number, "100%");
}

#[test]
fn registration_is_idempotent_and_references_protect_the_source_batch() {
    let connection = database();
    let source = save_product(&connection, None, product("001")).unwrap();
    let first = register_product(&connection, &source.id, "additive").unwrap();
    let again = register_product(&connection, &source.id, "additive").unwrap();
    assert_eq!(first.additive_id, again.additive_id);
    let both = register_product(&connection, &source.id, "base_oil").unwrap();
    let additive_id = both.additive_id.unwrap();
    let (molecule_id, name): (Option<String>, String) = connection
        .query_row(
            &format!("{ADDITIVE_SELECT} WHERE a.id = ?1"),
            [&additive_id],
            |r| Ok((r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert!(molecule_id.is_none());
    assert!(name.contains(&source.data.name));
    assert!(name.contains("00042"));
    assert!(name.contains("001"));
    connection.execute_batch("INSERT INTO formulations (id, name, created_at, updated_at) VALUES ('f', 'Blend', 'now', 'now');").unwrap();
    connection.execute("INSERT INTO formulation_components (id, formulation_id, component_role, additive_id, concentration_value)
        VALUES ('c', 'f', 'additive', ?1, 1)", [&additive_id]).unwrap();
    assert!(delete_product(&connection, &source.id)
        .unwrap_err()
        .contains("product.inUse"));
    assert!(connection
        .execute("DELETE FROM additives WHERE id = ?1", [&additive_id])
        .is_err());
    connection
        .execute("DELETE FROM formulation_components WHERE id = 'c'", [])
        .unwrap();
    connection
        .execute("DELETE FROM additives WHERE id = ?1", [&additive_id])
        .unwrap();
    connection
        .execute(
            "DELETE FROM base_oils WHERE id = ?1",
            [both.base_oil_id.unwrap()],
        )
        .unwrap();
    delete_product(&connection, &source.id).unwrap();
}

#[test]
fn a_commercial_additive_cannot_disappear_from_a_modelled_blend() {
    let connection = database();
    let source = save_product(&connection, None, product("001")).unwrap();
    let source = register_product(&connection, &source.id, "additive").unwrap();
    connection.execute_batch("INSERT INTO molecules (id, name, created_at, updated_at) VALUES ('m', 'Molecule', 'now', 'now');
        INSERT INTO molecule_descriptors (id, molecule_id, descriptor_set, descriptors_json, mode, status) VALUES ('d', 'm', 'rdkit', '{\"MolWt\":100}', 'real', 'calculated');
        INSERT INTO additives (id, molecule_id, created_at, updated_at) VALUES ('a', 'm', 'now', 'now');
        INSERT INTO formulations (id, name, created_at, updated_at) VALUES ('f', 'Blend', 'now', 'now');
        INSERT INTO formulation_components (id, formulation_id, component_role, additive_id, concentration_value, concentration_unit) VALUES ('c1', 'f', 'additive', 'a', 1, 'wt%');
        INSERT INTO experiments (id, formulation_id, created_at, updated_at) VALUES ('e', 'f', 'now', 'now');
        INSERT INTO performance_results (id, experiment_id, average_friction_coefficient, created_at, updated_at) VALUES ('r', 'e', 0.1, 'now', 'now');").unwrap();
    connection.execute("INSERT INTO formulation_components (id, formulation_id, component_role, additive_id, concentration_value, concentration_unit)
        VALUES ('c2', 'f', 'additive', ?1, 2, 'wt%')", [source.additive_id.unwrap()]).unwrap();
    for mode in ["additive_component", "formulation_aggregate"] {
        let result =
            dataset_summary(&connection, "average_friction_coefficient", "", mode).unwrap();
        assert_eq!(result["rowCount"], 0);
        assert_eq!(result["report"]["excludedNoDescriptors"], 1);
    }
    assert!(
        aggregate_feature_agreement(&connection, "average_friction_coefficient", "f")
            .unwrap_err()
            .contains("product.noDescriptors")
    );
}

#[test]
fn upgrading_v8_preserves_molecules_additives_and_formulation_links() {
    let root = std::env::temp_dir().join(format!("lmd-products-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let connection = Connection::open(root.join("lmd.sqlite")).unwrap();
    // Version 8 had no product reference and required a molecular additive source.
    let old_schema = INIT_SCHEMA_SQL.replace("  commercial_product_id TEXT UNIQUE REFERENCES commercial_products(id),\n", "")
        .replace("CREATE TABLE IF NOT EXISTS additives (\n  id TEXT PRIMARY KEY,\n  molecule_id TEXT,", "CREATE TABLE IF NOT EXISTS additives (\n  id TEXT PRIMARY KEY,\n  molecule_id TEXT NOT NULL,")
        .replace("  CONSTRAINT additive_has_one_source CHECK (\n    (CASE WHEN molecule_id IS NOT NULL AND molecule_id <> '' THEN 1 ELSE 0 END)\n    + (CASE WHEN commercial_product_id IS NOT NULL THEN 1 ELSE 0 END) = 1\n  ),\n", "");
    connection.execute_batch(&old_schema).unwrap();
    connection.execute_batch("DROP TABLE commercial_products;
        INSERT INTO molecules (id, name, created_at, updated_at) VALUES ('m', 'Existing', 'old', 'old');
        INSERT INTO additives (id, molecule_id, created_at, updated_at) VALUES ('a', 'm', 'old', 'old');
        INSERT INTO formulations (id, name, created_at, updated_at) VALUES ('f', 'Existing blend', 'old', 'old');
        INSERT INTO formulation_components (id, formulation_id, component_role, additive_id) VALUES ('c', 'f', 'additive', 'a');
        PRAGMA user_version=8;").unwrap();
    drop(connection);
    initialize_database_at(&root).unwrap();
    let connection = Connection::open(root.join("lmd.sqlite")).unwrap();
    configure_connection(&connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT molecule_id FROM additives WHERE id='a'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "m"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT additive_id FROM formulation_components WHERE id='c'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "a"
    );
    let source = save_product(&connection, None, product("new")).unwrap();
    register_product(&connection, &source.id, "additive").unwrap();
    assert!(connection
        .execute(
            "INSERT INTO additives (id, created_at, updated_at) VALUES ('bad', 'now', 'now')",
            []
        )
        .is_err());
    assert!(connection
        .execute("DELETE FROM additives WHERE id=?1", params!["a"])
        .is_err());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    drop(connection);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn manual_properties_survive_edits_and_transfer_when_registering_a_base_oil() {
    use lubricant_materials_database::commands::commercial_product::{
        MaterialProperties, MaterialProperty,
    };
    let connection = database();
    let mut input = product("properties");
    input.material_properties = MaterialProperties {
        viscosity40c: Some(46.5),
        viscosity100c: Some(8.2),
        density: Some(0.86),
        viscosity_index: Some(145.0),
        pour_point: Some(-42.0),
        flash_point: Some(220.0),
        appearance: "Clear liquid".into(),
        conditions: "Density at 20 °C; supplier certificate".into(),
        custom: vec![MaterialProperty {
            name: "Acid number".into(),
            value: "0".into(),
            unit: "mg KOH/g".into(),
            conditions: "Batch certificate".into(),
        }],
        ..Default::default()
    };
    let record = save_product(&connection, None, input).unwrap();
    let loaded = get_product(&connection, &record.id).unwrap();
    assert_eq!(loaded.data.material_properties.pour_point, Some(-42.0));
    assert_eq!(loaded.data.material_properties.custom[0].value, "0");
    assert_eq!(loaded.data.material_properties.custom[0].unit, "mg KOH/g");
    assert_eq!(
        loaded.data.material_properties.conditions,
        "Density at 20 °C; supplier certificate"
    );
    let registered = register_product(&connection, &record.id, "base_oil").unwrap();
    let values: (f64, f64, f64, f64, f64, f64) = connection.query_row(
        "SELECT viscosity_40c, viscosity_100c, viscosity_index, density, pour_point, flash_point FROM base_oils WHERE id=?1",
        [registered.base_oil_id.unwrap()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).unwrap();
    assert_eq!(values, (46.5, 8.2, 145.0, 0.86, -42.0, 220.0));
    let mut edited = loaded.data;
    edited.material_properties.density = None;
    edited.material_properties.custom.clear();
    save_product(&connection, Some(&record.id), edited).unwrap();
    let cleared = get_product(&connection, &record.id).unwrap();
    assert_eq!(cleared.data.material_properties.density, None);
    assert!(cleared.data.material_properties.custom.is_empty());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM molecule_descriptors", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn invalid_manual_properties_are_rejected_without_changing_the_saved_record() {
    use lubricant_materials_database::commands::commercial_product::MaterialProperty;
    let connection = database();
    let record = save_product(&connection, None, product("valid")).unwrap();
    for value in [0.0, -1.0, f64::INFINITY, f64::NAN] {
        let mut input = product("invalid");
        input.material_properties.density = Some(value);
        assert!(save_product(&connection, Some(&record.id), input)
            .unwrap_err()
            .contains("product.invalidProperties"));
    }
    let mut input = product("invalid");
    input.material_properties.custom.push(MaterialProperty {
        name: " ".into(),
        value: "7".into(),
        ..Default::default()
    });
    assert!(save_product(&connection, Some(&record.id), input).is_err());
    assert_eq!(
        get_product(&connection, &record.id)
            .unwrap()
            .data
            .batch_number,
        "valid"
    );
}

#[test]
fn upgrading_a_v9_product_keeps_its_batch_and_starts_with_empty_manual_properties() {
    let root =
        std::env::temp_dir().join(format!("lmd-properties-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let connection = Connection::open(root.join("lmd.sqlite")).unwrap();
    connection
        .execute_batch(&INIT_SCHEMA_SQL.replace(
            "  material_properties_json TEXT NOT NULL DEFAULT '{}',\n",
            "",
        ))
        .unwrap();
    connection
        .execute_batch(
            "INSERT INTO commercial_products (id, name, batch_number, created_at, updated_at)
        VALUES ('p-old', 'Existing product', '0001', 'old', 'old'); PRAGMA user_version=9;",
        )
        .unwrap();
    drop(connection);
    initialize_database_at(&root).unwrap();
    let connection = Connection::open(root.join("lmd.sqlite")).unwrap();
    let old = get_product(&connection, "p-old").unwrap();
    assert_eq!(old.data.batch_number, "0001");
    assert_eq!(old.data.material_properties.viscosity40c, None);
    assert!(old.data.material_properties.custom.is_empty());
    let mut input = old.data;
    input.material_properties.viscosity40c = Some(32.0);
    save_product(&connection, Some("p-old"), input).unwrap();
    drop(connection);
    let connection = Connection::open(root.join("lmd.sqlite")).unwrap();
    assert_eq!(
        get_product(&connection, "p-old")
            .unwrap()
            .data
            .material_properties
            .viscosity40c,
        Some(32.0)
    );
    drop(connection);
    std::fs::remove_dir_all(root).unwrap();
}
