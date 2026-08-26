//! The LMD desktop application, as a library.
//!
//! The binary in `main.rs` is a thin Tauri shell around these modules. They live in a library
//! target so the integration tests in `tests/` can call the real command implementations against a
//! real SQLite file, instead of re-implementing the statement sequences they mean to verify — a
//! test that reproduces the code it is checking cannot catch a change in that code.

pub mod app_paths;
pub mod commands;
pub mod db;
