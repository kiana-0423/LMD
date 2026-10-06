# lmd-core

The LMD use cases that do not depend on how the application is hosted. The desktop application
(`src-tauri`) calls them today; a headless server is meant to call the same code later.

## Responsibility

A function here receives its dependencies as arguments: currently a `rusqlite::Connection`. It does
not resolve the active workspace, see a Tauri `AppHandle`, read desktop UI state, or read workspace
files. The desktop crate is the adapter. Its Tauri commands resolve the local workspace, open its
database, and call into this crate.

What it holds today:

- `molecules::list_molecules`: the filtered, paged molecule library, plus its filter and response
  types (`MoleculeListFilter`, `MoleculePageDto`, `MoleculeDto`). The desktop command
  `list_molecules` and the `commands::molecule::*` type paths re-export these unchanged.

The SQL is SQLite-specific and is not portable to another database as written. The SQLite schema
is still owned by the desktop crate (`src-tauri/src/db/schema.rs`).

## The boundary

The crate depends only on `rusqlite` (bundled SQLite), `serde` and `serde_json`. Tauri, its
plugins, `tauri-build` and the webview crates are not in its dependency graph, so code here that
reaches for them does not compile. `npm run audit:core-boundary` (part of `npm run audit`) fails
if any of them, or the desktop crate itself, enters the resolved graph.

## Build and test on its own

The crate is a member of the Cargo workspace rooted at `src-tauri/Cargo.toml`, so it shares the
desktop lockfile and target directory. Building it compiles only its own dependencies:

```bash
cd crates/lmd-core && cargo test          # or, from the repository root:
cargo test  --manifest-path src-tauri/Cargo.toml -p lmd-core
cargo clippy --manifest-path src-tauri/Cargo.toml -p lmd-core --all-targets -- -D warnings
cargo tree  --manifest-path src-tauri/Cargo.toml -p lmd-core -e normal,build,dev
```

A plain `cargo test`, `cargo clippy` or `cargo fmt` in `src-tauri` covers this crate as well.

## Tests

`tests/support/molecule_listing.rs` holds the behavioural scenarios, and two hosts run them:

- `tests/molecule_listing.rs`: in-memory SQLite with the shipped schema, with no desktop crate
  compiled.
- `src-tauri/tests/molecule_listing_service.rs`: a workspace created by the production initializer,
  migrations included.

A scenario added to the `molecule_listing_tests!` list runs in both.
