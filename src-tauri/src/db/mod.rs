pub mod migrations;
pub mod schema;

use rusqlite::Connection;
use std::path::Path;
use std::time::Duration;

pub fn open_database(path: impl AsRef<Path>) -> Result<Connection, rusqlite::Error> {
    let connection = Connection::open(path)?;
    configure_connection(&connection)?;
    Ok(connection)
}

pub fn configure_connection(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_connections_enforce_foreign_keys_and_wait_for_busy_databases() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        configure_connection(&connection).expect("connection should be configured");

        let foreign_keys: i64 = connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign_keys pragma should be readable");
        let busy_timeout: i64 = connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("busy_timeout pragma should be readable");

        assert_eq!(foreign_keys, 1);
        assert_eq!(busy_timeout, 5_000);
    }
}

#[cfg(test)]
mod schema_sync_tests {
    /// The integration tests read a plain-SQL copy of the schema. If it drifts from schema.rs the
    /// tests would silently validate a stale shape, so the two are compared here.
    #[test]
    fn the_test_schema_copy_matches_schema_rs() {
        let generated = include_str!("schema_for_tests.sql");
        let sql = generated
            .split_once('\n')
            .expect("the generated file starts with a header comment")
            .1;
        assert_eq!(
            sql,
            super::schema::INIT_SCHEMA_SQL,
            "schema_for_tests.sql is out of date; run `python scripts/sync_test_schema.py`"
        );
    }
}
