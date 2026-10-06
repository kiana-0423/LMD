//! LMD's use cases, independent of how the application is hosted.
//!
//! A function here takes its dependencies — today a SQLite connection — as arguments. It never
//! resolves the active workspace, never sees a Tauri `AppHandle`, and never reads desktop UI
//! state, so the desktop command that calls it now and a headless server that calls it later get
//! the same behaviour.
//!
//! That boundary is held by this crate's dependency list rather than by convention: the crate does
//! not depend on Tauri, so code that reaches for it does not compile. The desktop crate
//! (`src-tauri`) is the adapter that resolves the local workspace, opens its database, and calls
//! in here.

pub mod molecules;
