//! The shared molecule-listing service against a real workspace database, without a Tauri runtime.
//!
//! The workspace is created by the same initializer the application runs at startup, so the
//! schema and migrations under test are the shipped ones. The service is handed the connection
//! directly — no `AppHandle`, no active-workspace selection — which is the property that lets a
//! non-desktop host reuse it.
//!
//! The scenarios are `lmd-core`'s own (`crates/lmd-core/tests/support/molecule_listing.rs`); that
//! crate runs them against an in-memory database, and this file runs them against a workspace.

#[macro_use]
#[path = "../../crates/lmd-core/tests/support/molecule_listing.rs"]
mod molecule_listing_scenarios;

use lubricant_materials_database::db::migrations::initialize_database_at;
use lubricant_materials_database::db::open_database;
use rusqlite::Connection;
use std::path::PathBuf;

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "lmd-molecule-listing-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        initialize_database_at(&root).expect("workspace should initialize");
        Self { root }
    }

    fn open(&self) -> Connection {
        open_database(self.root.join("lmd.sqlite")).expect("database should open")
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn initialized_workspace(name: &str, scenario: fn(&mut Connection)) {
    let workspace = Workspace::new(name);
    let mut connection = workspace.open();
    scenario(&mut connection);
}

molecule_listing_tests!(initialized_workspace);

/// The desktop crate's established paths name the shared types, not copies of them, so the Tauri
/// command serializes exactly what the service returns. This compiles only while that holds.
#[test]
fn the_desktop_paths_name_the_shared_types() {
    use lubricant_materials_database::commands::molecule;

    let workspace = Workspace::new("paths");
    let filter: molecule::MoleculeListFilter = lmd_core::molecules::MoleculeListFilter::default();
    let page: molecule::MoleculePageDto =
        lmd_core::molecules::list_molecules(&workspace.open(), filter)
            .expect("listing should succeed");
    let items: Vec<molecule::MoleculeDto> = page.items;
    assert!(items.is_empty());
}
