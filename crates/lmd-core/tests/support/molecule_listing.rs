//! Behavioural scenarios for `lmd_core::molecules::list_molecules`, shared by every host.
//!
//! Each scenario receives an empty workspace database and seeds what it needs, so the same
//! assertions run wherever a database comes from:
//!
//!   * `crates/lmd-core/tests/molecule_listing.rs` — in-memory SQLite with the shipped schema,
//!     with no desktop crate compiled at all;
//!   * `src-tauri/tests/molecule_listing_service.rs` — a workspace file created by the production
//!     initializer, migrations included.
//!
//! An including file declares this module as `molecule_listing_scenarios` with `#[macro_use]`,
//! defines `fn <runner>(name: &str, scenario: fn(&mut Connection))`, and calls
//! `molecule_listing_tests!(<runner>)`. A scenario added to the list below then runs in both.
//!
//! The scenarios assert on what the service returns. None of them restates its SQL.

use lmd_core::molecules::{list_molecules, MoleculeListFilter, MoleculePageDto};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Declares one `#[test]` per scenario, each run against a fresh database from `$runner`.
macro_rules! molecule_listing_tests {
    ($runner:ident) => {
        molecule_listing_tests!(@each $runner;
            every_filter_narrows_the_page_and_the_total_together,
            element_filter_does_not_match_a_longer_symbol_with_the_same_first_letter,
            pages_are_clamped_and_report_the_values_actually_used,
            rows_created_in_the_same_second_page_in_a_stable_total_order,
            the_page_serializes_to_the_shape_the_frontend_reads,
        );
    };
    (@each $runner:ident; $($scenario:ident),* $(,)?) => {
        $(
            #[test]
            fn $scenario() {
                $runner(stringify!($scenario), molecule_listing_scenarios::$scenario);
            }
        )*
    };
}

pub struct Seed<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub created_at: &'a str,
    pub smiles: &'a str,
    pub inchi_key: &'a str,
    pub formula: &'a str,
    pub category: Option<&'a str>,
    pub source: Option<&'a str>,
    pub source_id: Option<&'a str>,
    pub import_mode: Option<&'a str>,
    pub duplicate_of: Option<&'a str>,
}

impl Default for Seed<'_> {
    fn default() -> Self {
        Seed {
            id: "",
            name: "",
            created_at: "2026-01-01T00:00:00+00:00",
            smiles: "",
            inchi_key: "",
            formula: "",
            category: None,
            source: None,
            source_id: None,
            import_mode: None,
            duplicate_of: None,
        }
    }
}

pub fn insert(connection: &Connection, seed: Seed<'_>) {
    connection
        .execute(
            "INSERT INTO molecules (
                id, name, smiles_canonical, inchi_key, formula, category, source, source_id,
                import_mode, duplicate_of, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                seed.id,
                seed.name,
                seed.smiles,
                seed.inchi_key,
                seed.formula,
                seed.category,
                seed.source,
                seed.source_id,
                seed.import_mode,
                seed.duplicate_of,
                seed.created_at
            ],
        )
        .expect("molecule should insert");
}

fn page(connection: &Connection, filter: Value) -> MoleculePageDto {
    let filter = MoleculeListFilter::from_json(Some(filter)).expect("filter should parse");
    list_molecules(connection, filter).expect("listing should succeed")
}

fn ids(connection: &Connection, filter: Value) -> (Vec<String>, i64) {
    let page = page(connection, filter);
    (
        page.items.into_iter().map(|molecule| molecule.id).collect(),
        page.total,
    )
}

/// A small library that every filter has something to say about.
fn seed_library(connection: &Connection) {
    insert(
        connection,
        Seed {
            id: "zddp",
            name: "Zinc Dialkyldithiophosphate",
            created_at: "2026-03-01T10:00:00+00:00",
            smiles: "CCCCOP(=S)(OCCCC)S[Zn]",
            inchi_key: "ZDDPKEY",
            formula: "C16H36O4P2S4Zn",
            category: Some("additive"),
            source: Some("import-a"),
            import_mode: Some("table_import"),
            ..Default::default()
        },
    );
    insert(
        connection,
        Seed {
            id: "zddp-copy",
            name: "ZDDP duplicate",
            created_at: "2026-03-02T10:00:00+00:00",
            smiles: "CCCCOP(=S)(OCCCC)S[Zn]",
            formula: "C16H36O4P2S4Zn",
            category: Some("additive"),
            source_id: Some("import-a"),
            import_mode: Some("table_import"),
            duplicate_of: Some("zddp"),
            ..Default::default()
        },
    );
    insert(
        connection,
        Seed {
            id: "pao",
            name: "PAO 6",
            created_at: "2026-02-01T10:00:00+00:00",
            smiles: "CCCCCCCCCCC",
            inchi_key: "PAOKEY",
            formula: "C30H62",
            category: Some("base_oil"),
            import_mode: Some("manual_save"),
            ..Default::default()
        },
    );
    insert(
        connection,
        Seed {
            id: "brominated",
            name: "Brominated amine",
            created_at: "2026-01-15T10:00:00+00:00",
            formula: "C20H42BrNO2",
            ..Default::default()
        },
    );
}

pub fn every_filter_narrows_the_page_and_the_total_together(connection: &mut Connection) {
    seed_library(connection);

    // No filter: everything, newest first.
    assert_eq!(
        ids(connection, json!({})),
        (
            vec![
                "zddp-copy".into(),
                "zddp".into(),
                "pao".into(),
                "brominated".into()
            ],
            4
        )
    );
    // Search is trimmed, case-insensitive, and covers name, canonical SMILES and InChIKey.
    assert_eq!(
        ids(connection, json!({ "search": "  pao 6 " })),
        (vec!["pao".into()], 1)
    );
    assert_eq!(
        ids(connection, json!({ "search": "cccccccccc" })),
        (vec!["pao".into()], 1)
    );
    assert_eq!(
        ids(connection, json!({ "search": "zddpkey" })),
        (vec!["zddp".into()], 1)
    );
    assert_eq!(
        ids(connection, json!({ "category": "base_oil" })),
        (vec!["pao".into()], 1)
    );
    // `source` matches either the source column or the legacy source id.
    assert_eq!(
        ids(connection, json!({ "source": "import-a" })),
        (vec!["zddp-copy".into(), "zddp".into()], 2)
    );
    assert_eq!(
        ids(connection, json!({ "importMode": "manual_save" })),
        (vec!["pao".into()], 1)
    );
    assert_eq!(
        ids(connection, json!({ "duplicateStatus": "duplicate" })),
        (vec!["zddp-copy".into()], 1)
    );
    assert_eq!(
        ids(connection, json!({ "duplicateStatus": "original" })).1,
        3
    );
    // Bromine is not boron.
    assert_eq!(ids(connection, json!({ "element": "B" })), (vec![], 0));
    assert_eq!(
        ids(connection, json!({ "element": "Br" })),
        (vec!["brominated".into()], 1)
    );
    // Filters combine.
    assert_eq!(
        ids(
            connection,
            json!({ "category": "additive", "duplicateStatus": "original", "element": "Zn" })
        ),
        (vec!["zddp".into()], 1)
    );
}

pub fn element_filter_does_not_match_a_longer_symbol_with_the_same_first_letter(
    connection: &mut Connection,
) {
    for (index, (id, formula)) in [
        ("brominated", "C20H42BrNO2"),
        ("silicone", "C10H22SiO"),
        ("sodium", "C8H18NaO"),
        ("borate", "BF3"),
        ("ends-with-boron", "C6H5B"),
        ("thiophosphate", "C6H15O3PS2"),
    ]
    .into_iter()
    .enumerate()
    {
        insert(
            connection,
            Seed {
                id,
                name: id,
                formula,
                created_at: &format!("2026-08-20T09:00:00.{index:09}+00:00"),
                ..Default::default()
            },
        );
    }
    let matches = |element: &str| {
        let mut found = ids(connection, json!({ "element": element })).0;
        found.sort();
        found
    };

    // Boron must not pick up bromine, sulfur must not pick up silicon, nitrogen must not pick up
    // sodium.
    assert_eq!(matches("B"), vec!["borate", "ends-with-boron"]);
    assert_eq!(matches("S"), vec!["thiophosphate"]);
    assert_eq!(matches("N"), vec!["brominated"]);
    assert_eq!(matches("P"), vec!["thiophosphate"]);
}

pub fn pages_are_clamped_and_report_the_values_actually_used(connection: &mut Connection) {
    {
        let transaction = connection.transaction().expect("transaction should start");
        for index in 0..230 {
            insert(
                &transaction,
                Seed {
                    id: &format!("mol-{index:03}"),
                    name: &format!("Molecule {index}"),
                    created_at: &format!("2026-05-01T08:00:00.{index:06}+00:00"),
                    ..Default::default()
                },
            );
        }
        transaction.commit().expect("seed should commit");
    }

    // Defaults: first page of 50.
    let first = page(connection, json!({}));
    assert_eq!((first.page, first.page_size, first.total), (1, 50, 230));
    assert_eq!(first.items.len(), 50);
    assert_eq!(first.items[0].id, "mol-229");

    // A page below 1 is the first page; a non-positive size is the default.
    let clamped = page(connection, json!({ "page": -3, "pageSize": 0 }));
    assert_eq!((clamped.page, clamped.page_size), (1, 50));
    assert_eq!(clamped.items[0].id, "mol-229");

    // Sizes above the maximum are capped.
    let capped = page(connection, json!({ "pageSize": 1000 }));
    assert_eq!(capped.page_size, 200);
    assert_eq!(capped.items.len(), 200);

    // The last partial page, then past the end: empty items, unchanged total.
    let last = page(connection, json!({ "page": 5, "pageSize": 50 }));
    assert_eq!(last.items.len(), 30);
    assert_eq!(last.items.last().map(|m| m.id.as_str()), Some("mol-000"));
    let beyond = page(connection, json!({ "page": 9, "pageSize": 50 }));
    assert!(beyond.items.is_empty());
    assert_eq!(beyond.total, 230);
}

pub fn rows_created_in_the_same_second_page_in_a_stable_total_order(connection: &mut Connection) {
    // Distinct sub-second timestamps that all collapse to the same `datetime()` value, exactly
    // what a bulk import produces.
    for index in 0..25 {
        insert(
            connection,
            Seed {
                id: &format!("molecule-{index:03}"),
                name: &format!("Molecule {index}"),
                created_at: &format!("2026-08-20T09:00:00.{index:09}+00:00"),
                ..Default::default()
            },
        );
    }

    let mut seen = Vec::new();
    for number in 1..=5 {
        seen.extend(ids(connection, json!({ "page": number, "pageSize": 5 })).0);
    }
    assert_eq!(seen.len(), 25);
    assert_eq!(seen.iter().collect::<HashSet<_>>().len(), 25);
    assert_eq!(seen.first().map(String::as_str), Some("molecule-024"));
    assert_eq!(seen.last().map(String::as_str), Some("molecule-000"));

    let again = ids(connection, json!({ "page": 1, "pageSize": 25 })).0;
    assert_eq!(again, seen);
}

pub fn the_page_serializes_to_the_shape_the_frontend_reads(connection: &mut Connection) {
    connection
        .execute(
            "INSERT INTO molecules (
                id, name, tags, molfile, source_id, structure_svg_path, mol_file_path,
                descriptor_ready, created_at, updated_at
             ) VALUES (
                'm-1', 'Ester', '[\"antiwear\",\"friction\"]', 'M  END', 'legacy-src',
                'files/structures/m-1.svg', 'files/structures/m-1.mol', 1,
                '2026-01-01T00:00:00+00:00', '2026-01-02T00:00:00+00:00'
             )",
            [],
        )
        .expect("molecule should insert");

    let page = list_molecules(
        connection,
        MoleculeListFilter::from_json(None).expect("no filter is the default filter"),
    )
    .expect("listing should succeed");
    let value = serde_json::to_value(&page).expect("page should serialize");

    let mut page_keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
    page_keys.sort();
    assert_eq!(page_keys, ["items", "page", "pageSize", "total"]);

    let item = &value["items"][0];
    let mut item_keys: Vec<_> = item.as_object().unwrap().keys().cloned().collect();
    item_keys.sort();
    assert_eq!(
        item_keys,
        [
            "additiveFunctionTags",
            "aliases",
            "category",
            "createdAt",
            "dataSource",
            "descriptorReady",
            "duplicateOf",
            "formula",
            "id",
            "importMode",
            "inchi",
            "inchiKey",
            "molBlock",
            "molFilePath",
            "molecularWeight",
            "molfile",
            "mordredDescriptorStatus",
            "name",
            "notes",
            "pdbBlock",
            "pdbFilePath",
            "rdkitDescriptorStatus",
            "sdfBlock",
            "sdfFilePath",
            "smilesCanonical",
            "smilesRaw",
            "source",
            "sourceId",
            "structureSvg",
            "structureSvgPath",
            "tags",
            "updatedAt"
        ]
    );

    // Defaults for columns left empty, and the legacy source id standing in for a missing source.
    assert_eq!(item["category"], "candidate");
    assert_eq!(item["importMode"], "manual_save");
    assert_eq!(item["rdkitDescriptorStatus"], "pending");
    assert_eq!(item["mordredDescriptorStatus"], "pending");
    assert_eq!(item["descriptorReady"], true);
    assert_eq!(item["source"], "legacy-src");
    assert_eq!(item["sourceId"], "legacy-src");
    assert_eq!(item["dataSource"], "legacy-src");
    assert_eq!(item["tags"], json!(["antiwear", "friction"]));
    assert_eq!(
        item["additiveFunctionTags"],
        json!(["antiwear", "friction"])
    );
    assert_eq!(item["molecularWeight"], 0.0);
    // A listing carries file paths, never file contents.
    assert_eq!(item["structureSvgPath"], "files/structures/m-1.svg");
    assert_eq!(item["structureSvg"], "");
    assert_eq!(item["molfile"], "M  END");
    assert_eq!(item["molBlock"], "");
}
