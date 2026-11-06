use lubricant_materials_database::commands::backup::{create_backup, restore_backup};
use lubricant_materials_database::commands::portable::{
    export_archive, import_archive, preview_archive,
};
use lubricant_materials_database::db::{migrations::initialize_database_at, open_database};
use rusqlite::{types::Value, Connection};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn seed(root: &Path) -> Connection {
    initialize_database_at(root).unwrap();
    let db = open_database(root.join("lmd.sqlite")).unwrap();
    db.execute_batch("PRAGMA wal_autocheckpoint=0;
        INSERT INTO molecules(id,name,mol_file_path,created_at,updated_at) VALUES('m','分子 日本語 µ','files/structures/分子.mol','t','t');
        INSERT INTO molecule_descriptors(id,molecule_id,descriptor_set,descriptors_json,status) VALUES('d','m','rdkit','{\"x\":1.234567890123}','success');
        INSERT INTO commercial_products(id,name,created_at,updated_at) VALUES('p','Product','t','t');
        INSERT INTO base_oils(id,name,created_at,updated_at) VALUES('b','Oil','t','t');
        INSERT INTO additives(id,molecule_id,created_at,updated_at) VALUES('a','m','t','t');
        INSERT INTO formulations(id,name,created_at,updated_at) VALUES('f','Blend','t','t');
        INSERT INTO formulation_components(id,formulation_id,component_role,molecule_id,concentration_value) VALUES('fc','f','additive','m',1.2);
        INSERT INTO experiments(id,formulation_id,created_at,updated_at) VALUES('e','f','t','t');
        INSERT INTO performance_results(id,experiment_id,average_friction_coefficient,created_at,updated_at) VALUES('r','e',0.123456789,'t','t');
        INSERT INTO attachments(id,linked_entity_type,linked_entity_id,file_name,relative_path,uploaded_at) VALUES('at','molecule','m','报告.pdf','files/reports/报告.pdf','t');
        INSERT INTO data_sources(id,title,created_at,updated_at) VALUES('s','引用','t','t');
        INSERT INTO jobs(id,job_type,status,input_json,created_at,updated_at) VALUES('j','design','succeeded','{\"full\":true}','t','t');
        INSERT INTO models(id,name,target,task,algorithm,model_version,relative_path,feature_order,metrics_json,sample_count,feature_count,trained_at,created_at,updated_at) VALUES('model','Model','friction','regression','ridge','1','files/models/model.joblib','[\"x\"]','{}',15,1,'t','t','t');
        INSERT INTO design_candidates(id,job_id,name,smiles_canonical,template_id,template_family,generator_version,validation_status,created_at,updated_at) VALUES('candidate','j','Candidate','CCO','t','f','1','valid','t','t');
        INSERT INTO design_candidate_descriptors(id,candidate_id,descriptor_set,descriptors_json,status) VALUES('cd','candidate','rdkit','{}','success');
        INSERT INTO design_predictions(id,candidate_id,job_id,target,status,predicted_value,created_at) VALUES('dp','candidate','j','friction','supported',0.11,'t');
        INSERT INTO settings(key,value,updated_at) VALUES('locale','zh-CN','t');
        CREATE TABLE future_data(id INTEGER PRIMARY KEY AUTOINCREMENT, payload BLOB, nullable TEXT);
        INSERT INTO future_data(payload) VALUES(X'000102ff');").unwrap();
    fs::write(
        root.join("files/structures/分子.mol"),
        b"exact molecule bytes\r\n",
    )
    .unwrap();
    fs::write(root.join("files/reports/报告.pdf"), [0, 255, 123, 4]).unwrap();
    fs::write(
        root.join("files/models/model.joblib"),
        b"model bytes only; never executed",
    )
    .unwrap();
    fs::write(
        root.join("files/models/model.reference.json"),
        b"{\"data\":[1,2,3]}",
    )
    .unwrap();
    fs::write(root.join("files/imports/empty.txt"), b"").unwrap();
    db
}

fn rows(db: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let mut query = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap();
    let tables = query
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    tables
        .into_iter()
        .map(|table| {
            let mut query = db
                .prepare(&format!(
                    "SELECT * FROM \"{}\" ORDER BY rowid",
                    table.replace('"', "\"\"")
                ))
                .unwrap();
            let width = query.column_count();
            let values = query
                .query_map([], |row| {
                    (0..width)
                        .map(|index| row.get(index))
                        .collect::<Result<Vec<Value>, _>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            (table, values)
        })
        .collect()
}

fn rewrite_archive(path: &Path, edit: impl FnOnce(&mut Vec<(String, Vec<u8>)>)) {
    let mut zip = ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let mut entries = (0..zip.len())
        .map(|i| {
            let mut entry = zip.by_index(i).unwrap();
            let name = entry.name().to_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            (name, bytes)
        })
        .collect::<Vec<_>>();
    drop(zip);
    edit(&mut entries);
    let mut writer = ZipWriter::new(fs::File::create(path).unwrap());
    for (name, data) in entries {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&data).unwrap();
    }
    writer.finish().unwrap();
}

#[test]
fn all_tables_and_files_round_trip_including_open_wal_unicode_and_binary_values() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let live = seed(&source); // Remains open: uncheckpointed committed rows are in the WAL.
    assert!(source.join("lmd.sqlite-wal").exists());
    let before = rows(&live);
    let archive = temp.path().join("complete.zip");
    let preview = export_archive(&source, &archive).unwrap();
    assert_eq!(preview.manifest.files.len(), 6);
    let result = import_archive(&archive, temp.path(), &preview.sha256).unwrap();
    assert!(result.report.ok);
    assert_ne!(Path::new(&result.workspace_path), source);
    let restored = open_database(Path::new(&result.workspace_path).join("lmd.sqlite")).unwrap();
    assert_eq!(
        rows(&restored),
        before,
        "every table, value, NULL, blob and primary key must survive"
    );
    assert_eq!(rows(&live), before, "source is unchanged");
    for file in preview
        .manifest
        .files
        .iter()
        .filter(|file| file.path != "lmd.sqlite")
    {
        assert_eq!(
            fs::read(source.join(&file.path)).unwrap(),
            fs::read(Path::new(&result.workspace_path).join(&file.path)).unwrap()
        );
    }
    // CI passes this fixture from Linux to the native macOS and Windows builders.
    if let Some(path) = std::env::var_os("LMD_ARCHIVE_FIXTURE_OUT") {
        fs::copy(&archive, path).unwrap();
    }
}

#[test]
fn imports_fixture_created_on_another_operating_system() {
    let Some(path) = std::env::var_os("LMD_ARCHIVE_FIXTURE_IN") else {
        return;
    };
    let path = Path::new(&path);
    let preview = preview_archive(path).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let imported = import_archive(path, temp.path(), &preview.sha256).unwrap();
    let reference = temp.path().join("reference");
    let db = seed(&reference);
    let restored = open_database(Path::new(&imported.workspace_path).join("lmd.sqlite")).unwrap();
    assert_eq!(rows(&restored), rows(&db));
    for file in preview
        .manifest
        .files
        .iter()
        .filter(|file| file.path != "lmd.sqlite")
    {
        assert_eq!(
            fs::read(reference.join(&file.path)).unwrap(),
            fs::read(Path::new(&imported.workspace_path).join(&file.path)).unwrap()
        );
    }
}

#[test]
fn normalizes_legacy_windows_paths_without_changing_the_source() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let live = seed(&source);
    live.execute(
        "UPDATE molecules SET mol_file_path=?1",
        ["files\\structures\\分子.mol"],
    )
    .unwrap();
    let archive = temp.path().join("complete.zip");
    let preview = export_archive(&source, &archive).unwrap();
    let result = import_archive(&archive, temp.path(), &preview.sha256).unwrap();
    let restored = open_database(Path::new(&result.workspace_path).join("lmd.sqlite")).unwrap();
    let get = |db: &Connection| {
        db.query_row("SELECT mol_file_path FROM molecules", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap()
    };
    assert_eq!(get(&live), "files\\structures\\分子.mol");
    assert_eq!(get(&restored), "files/structures/分子.mol");
}

#[test]
fn corrupt_files_are_refused_and_partial_workspaces_are_removed() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let _live = seed(&source);
    let archive = temp.path().join("complete.zip");
    export_archive(&source, &archive).unwrap();
    rewrite_archive(&archive, |entries| {
        entries
            .iter_mut()
            .find(|(name, _)| name.ends_with("报告.pdf"))
            .unwrap()
            .1[0] ^= 1
    });
    let preview = preview_archive(&archive).unwrap();
    let parent = temp.path().join("imports");
    fs::create_dir(&parent).unwrap();
    assert!(import_archive(&archive, &parent, &preview.sha256)
        .unwrap_err()
        .contains("checksum"));
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
}

#[test]
fn changed_preview_and_incorrect_table_counts_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let _db = seed(&source);
    let archive = temp.path().join("complete.zip");
    let preview = export_archive(&source, &archive).unwrap();
    rewrite_archive(&archive, |entries| {
        let data = &mut entries
            .iter_mut()
            .find(|(name, _)| name == "manifest.json")
            .unwrap()
            .1;
        let mut manifest: serde_json::Value = serde_json::from_slice(data).unwrap();
        manifest["tableCounts"]["molecules"] = 999.into();
        *data = serde_json::to_vec(&manifest).unwrap();
    });
    assert!(import_archive(&archive, temp.path(), &preview.sha256)
        .unwrap_err()
        .contains("changed after preview"));
    let newer = preview_archive(&archive).unwrap();
    assert!(import_archive(&archive, temp.path(), &newer.sha256)
        .unwrap_err()
        .contains("table counts"));
}

#[test]
fn traversal_absolute_device_and_case_colliding_paths_are_refused() {
    for bad in [
        "../outside",
        "/absolute",
        "C:/escape",
        "files/../escape",
        "files/a\\b",
        "files/CON.txt",
        "files/a:stream",
        "files/trailing.",
        "files/Models/model.joblib",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let _db = seed(&source);
        let archive = temp.path().join("complete.zip");
        export_archive(&source, &archive).unwrap();
        rewrite_archive(&archive, |entries| {
            let data = &mut entries
                .iter_mut()
                .find(|(name, _)| name == "manifest.json")
                .unwrap()
                .1;
            let mut manifest: serde_json::Value = serde_json::from_slice(data).unwrap();
            manifest["files"][1]["path"] = bad.into();
            *data = serde_json::to_vec(&manifest).unwrap();
        });
        assert!(preview_archive(&archive).is_err(), "must refuse {bad}");
    }
}

#[test]
fn export_refuses_missing_files_and_active_jobs_and_preserves_existing_destination() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let db = seed(&source);
    let archive = temp.path().join("complete.zip");
    fs::write(&archive, b"previous backup").unwrap();
    db.execute("UPDATE jobs SET status='running'", []).unwrap();
    assert!(export_archive(&source, &archive)
        .unwrap_err()
        .contains("jobs"));
    db.execute("UPDATE jobs SET status='succeeded'", [])
        .unwrap();
    fs::remove_file(source.join("files/models/model.joblib")).unwrap();
    assert!(export_archive(&source, &archive)
        .unwrap_err()
        .contains("missing"));
    assert_eq!(fs::read(&archive).unwrap(), b"previous backup");
    assert!(export_archive(&source, &source.join("lmd.sqlite")).is_err());
}

#[test]
fn backup_to_itself_or_a_failed_backup_never_destroys_existing_data() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let db = seed(&source);
    let before = rows(&db);
    let database = source.join("lmd.sqlite");
    assert!(create_backup(&database, &database).is_err());
    assert_eq!(rows(&db), before);
    let invalid = temp.path().join("invalid.sqlite");
    fs::write(&invalid, b"broken").unwrap();
    let saved = temp.path().join("saved.sqlite");
    fs::write(&saved, b"keep me").unwrap();
    assert!(create_backup(&invalid, &saved).is_err());
    assert_eq!(fs::read(saved).unwrap(), b"keep me");
}

#[test]
fn restore_refuses_unrelated_or_newer_databases_and_supports_existing_connections() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let db = seed(&source);
    let database = source.join("lmd.sqlite");
    let before = rows(&db);
    let other = temp.path().join("unrelated.sqlite");
    let unrelated = Connection::open(&other).unwrap();
    unrelated
        .execute_batch("CREATE TABLE arbitrary(value)")
        .unwrap();
    drop(unrelated);
    assert!(restore_backup(&source, &database, &other, "test").is_err());
    assert_eq!(rows(&db), before);
    let backup = temp.path().join("snapshot.sqlite");
    create_backup(&database, &backup).unwrap();
    db.execute("UPDATE molecules SET name='later'", []).unwrap();
    restore_backup(&source, &database, &backup, "test").unwrap();
    assert_eq!(
        rows(&db),
        before,
        "an existing connection must see the restored database"
    );
    let future = Connection::open(&backup).unwrap();
    future.pragma_update(None, "user_version", 999).unwrap();
    drop(future);
    assert!(restore_backup(&source, &database, &backup, "test2").is_err());
    assert_eq!(rows(&db), before);
}

#[cfg(unix)]
#[test]
fn symlinked_workspace_files_cannot_escape_into_a_backup() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let _db = seed(&source);
    let outside = temp.path().join("outside");
    fs::write(&outside, b"private").unwrap();
    std::os::unix::fs::symlink(&outside, source.join("files/escape")).unwrap();
    assert!(export_archive(&source, &temp.path().join("backup.zip"))
        .unwrap_err()
        .contains("Symbolic link"));
}

#[test]
fn newer_databases_are_refused_before_any_schema_change_and_versions_agree() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("lmd.sqlite");
    let db = Connection::open(&database).unwrap();
    db.execute_batch("CREATE TABLE future_only(value); PRAGMA user_version=999;")
        .unwrap();
    assert!(initialize_database_at(temp.path()).is_err());
    let tables: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1);
    assert_eq!(
        lubricant_materials_database::commands::workspace::SUPPORTED_SCHEMA_VERSION,
        lubricant_materials_database::db::migrations::LATEST_SCHEMA_VERSION
    );
}

#[test]
fn unsupported_archive_versions_and_missing_entries_are_refused() {
    for field in ["version", "schemaVersion"] {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let _db = seed(&source);
        let archive = temp.path().join("backup.zip");
        export_archive(&source, &archive).unwrap();
        rewrite_archive(&archive, |entries| {
            let data = &mut entries
                .iter_mut()
                .find(|(name, _)| name == "manifest.json")
                .unwrap()
                .1;
            let mut manifest: serde_json::Value = serde_json::from_slice(data).unwrap();
            manifest[field] = 999.into();
            *data = serde_json::to_vec(&manifest).unwrap();
        });
        assert!(preview_archive(&archive).is_err());
        export_archive(&source, &archive).unwrap();
        rewrite_archive(&archive, |entries| {
            entries.retain(|(name, _)| name != "lmd.sqlite");
        });
        assert!(preview_archive(&archive).is_err());
    }
}
