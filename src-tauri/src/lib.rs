//! The LMD desktop application, as a library.
//!
//! The binary in `main.rs` is a thin Tauri shell around these modules. They live in a library
//! target so the integration tests in `tests/` can call the real command implementations against a
//! real SQLite file, instead of re-implementing the statement sequences they mean to verify — a
//! test that reproduces the code it is checking cannot catch a change in that code.
//!
//! Use cases that do not depend on the desktop host live in the `lmd-core` crate
//! (`crates/lmd-core`), which cannot depend on Tauri. `commands` holds the Tauri adapters that
//! resolve the local workspace, open it, and call into that crate.

pub mod app_paths;
pub mod commands;
pub mod db;
