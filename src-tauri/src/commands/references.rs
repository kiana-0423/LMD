//! What a record is used by, and what deleting it would take with it.
//!
//! Deleting a base oil used to run `DELETE FROM formulation_components WHERE base_oil_id = ?`
//! first. That statement succeeds silently, and every blend built on that oil quietly lost the oil
//! it was built on — the formulation stayed, its base-oil row did not, and the remaining additive
//! percentages then described a mixture that cannot exist. Nothing in the interface said so.
//!
//! The default is now a refusal that names what is in the way. The destructive version still
//! exists, because a mis-entered oil that was never really used has to be removable, but it is a
//! separate command, it demands an explicit acknowledgement, and it reports every row it removed.

use crate::commands::errors::{self, coded};
use rusqlite::{params, Connection};
use serde::Serialize;

/// One formulation that references the record a caller wants to delete.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedFormulation {
    pub formulation_id: String,
    pub formulation_name: String,
    /// How many components of that formulation point at the record.
    pub component_count: i64,
    /// The roles those components fill, so the message can say *how* it is used.
    pub component_roles: Vec<String>,
}

/// The outcome of a delete request, whether or not anything was deleted.
///
/// A blocked delete is not an error: the user asked a reasonable question and the answer is "not
/// while these formulations exist". Returning it as data rather than as `Err` is what lets the
/// interface list the formulations by name instead of printing a sentence about them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionOutcome {
    pub id: String,
    /// True when the row is gone.
    pub deleted: bool,
    /// Mirrors `deleted`; kept because every other delete command in LMD reports both.
    pub success: bool,
    /// True when the delete was refused because something references the row.
    pub blocked: bool,
    /// The formulations that blocked it, or that a cascade removed components from.
    pub blocked_by: Vec<AffectedFormulation>,
    /// How many `formulation_components` rows a cascade removed. Zero for a blocked or plain
    /// delete.
    pub removed_components: i64,
}

impl DeletionOutcome {
    pub fn blocked(id: &str, blocked_by: Vec<AffectedFormulation>) -> Self {
        Self {
            id: id.to_string(),
            deleted: false,
            success: false,
            blocked: true,
            blocked_by,
            removed_components: 0,
        }
    }

    pub fn deleted(id: &str, deleted: bool) -> Self {
        Self {
            id: id.to_string(),
            deleted,
            success: deleted,
            blocked: false,
            blocked_by: Vec::new(),
            removed_components: 0,
        }
    }
}

/// Which column of `formulation_components` links to the record being deleted.
#[derive(Debug, Clone, Copy)]
pub enum ComponentLink {
    BaseOil,
    Additive,
    Molecule,
}

impl ComponentLink {
    fn column(self) -> &'static str {
        match self {
            Self::BaseOil => "base_oil_id",
            Self::Additive => "additive_id",
            Self::Molecule => "molecule_id",
        }
    }

    /// The word used in the refusal message.
    pub fn label(self) -> &'static str {
        match self {
            Self::BaseOil => "base oil",
            Self::Additive => "additive",
            Self::Molecule => "molecule",
        }
    }
}

/// Every formulation that references the record, newest formulation first.
///
/// One query, grouped in SQLite. A per-formulation follow-up would be a second N+1 in a code path
/// whose whole purpose is to be careful.
pub fn affected_formulations(
    connection: &Connection,
    link: ComponentLink,
    id: &str,
) -> Result<Vec<AffectedFormulation>, String> {
    let sql = format!(
        "SELECT fc.formulation_id,
                COALESCE(f.name, ''),
                COUNT(*),
                GROUP_CONCAT(DISTINCT fc.component_role)
         FROM formulation_components fc
         LEFT JOIN formulations f ON f.id = fc.formulation_id
         WHERE fc.{column} = ?1
         GROUP BY fc.formulation_id
         ORDER BY datetime(f.created_at) DESC, f.created_at DESC, fc.formulation_id DESC",
        column = link.column()
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the reference query: {err}"))?;
    let rows = statement
        .query_map(params![id], |row| {
            let roles: Option<String> = row.get(3)?;
            Ok(AffectedFormulation {
                formulation_id: row.get(0)?,
                formulation_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                component_count: row.get(2)?,
                component_roles: roles
                    .unwrap_or_default()
                    .split(',')
                    .map(str::trim)
                    .filter(|role| !role.is_empty())
                    .map(ToOwned::to_owned)
                    .collect(),
            })
        })
        .map_err(|err| format!("Failed to read references: {err}"))?;
    let mut affected = Vec::new();
    for row in rows {
        affected.push(row.map_err(|err| format!("Failed to read a reference row: {err}"))?);
    }
    Ok(affected)
}

/// The message a refused delete carries, in the codebase's `[code] detail` shape.
///
/// The detail names the formulations, so the error is actionable even for a caller that cannot
/// render the structured list.
pub fn blocked_message(link: ComponentLink, affected: &[AffectedFormulation]) -> String {
    let names = affected
        .iter()
        .map(|item| {
            if item.formulation_name.is_empty() {
                item.formulation_id.clone()
            } else {
                item.formulation_name.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    coded(
        errors::DELETE_BLOCKED_BY_REFERENCES,
        format!(
            "This {label} is used by {count} formulation(s): {names}. Remove or reassign those \
             components first, or use the explicit cascading delete.",
            label = link.label(),
            count = affected.len(),
        ),
    )
}

/// Refuses a cascade that was requested without acknowledgement.
pub fn require_cascade_confirmation(
    confirm_cascade: bool,
    link: ComponentLink,
    affected: &[AffectedFormulation],
) -> Result<(), String> {
    if confirm_cascade {
        return Ok(());
    }
    let components: i64 = affected.iter().map(|item| item.component_count).sum();
    Err(coded(
        errors::DELETE_CASCADE_NOT_CONFIRMED,
        format!(
            "Deleting this {label} would remove {components} component(s) from {formulations} \
             formulation(s). Confirm the cascade explicitly to proceed.",
            label = link.label(),
            formulations = affected.len(),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn workspace() -> Connection {
        let connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute_batch(
                r#"
                INSERT INTO base_oils (id, name, created_at, updated_at)
                  VALUES ('bo-1', 'PAO 6', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('f-1', 'Blend A', '2026-01-02', '2026-01-02'),
                         ('f-2', 'Blend B', '2026-01-03', '2026-01-03');
                INSERT INTO formulation_components (id, formulation_id, component_role, base_oil_id)
                  VALUES ('c-1', 'f-1', 'base_oil', 'bo-1'),
                         ('c-2', 'f-2', 'base_oil', 'bo-1'),
                         ('c-3', 'f-2', 'other', 'bo-1');
                "#,
            )
            .expect("fixture should insert");
        connection
    }

    #[test]
    fn every_referencing_formulation_is_reported_once_with_its_component_count() {
        let connection = workspace();

        let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-1")
            .expect("references should read");

        assert_eq!(
            affected.len(),
            2,
            "one row per formulation, not per component"
        );
        let blend_b = affected
            .iter()
            .find(|item| item.formulation_id == "f-2")
            .expect("Blend B references the oil");
        assert_eq!(blend_b.formulation_name, "Blend B");
        assert_eq!(blend_b.component_count, 2);
        let mut roles = blend_b.component_roles.clone();
        roles.sort();
        assert_eq!(roles, vec!["base_oil".to_string(), "other".to_string()]);
    }

    #[test]
    fn an_unreferenced_record_reports_nothing() {
        let connection = workspace();
        let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-unused")
            .expect("references should read");
        assert!(affected.is_empty());
    }

    #[test]
    fn the_refusal_names_the_formulations_and_carries_a_stable_code() {
        let connection = workspace();
        let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-1")
            .expect("references should read");

        let message = blocked_message(ComponentLink::BaseOil, &affected);

        assert!(message.starts_with(&format!("[{}]", errors::DELETE_BLOCKED_BY_REFERENCES)));
        assert!(message.contains("Blend A"));
        assert!(message.contains("Blend B"));
    }

    #[test]
    fn a_cascade_without_acknowledgement_is_refused_and_says_what_it_would_remove() {
        let connection = workspace();
        let affected = affected_formulations(&connection, ComponentLink::BaseOil, "bo-1")
            .expect("references should read");

        let error = require_cascade_confirmation(false, ComponentLink::BaseOil, &affected)
            .expect_err("an unconfirmed cascade is refused");
        assert!(error.starts_with(&format!("[{}]", errors::DELETE_CASCADE_NOT_CONFIRMED)));
        assert!(error.contains("3 component(s)"));
        assert!(error.contains("2 formulation(s)"));

        assert!(require_cascade_confirmation(true, ComponentLink::BaseOil, &affected).is_ok());
    }
}
