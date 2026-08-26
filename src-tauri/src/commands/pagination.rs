//! Bounded, deterministically ordered pages.
//!
//! Every list command used to return the whole table. That is fine with twelve formulations and
//! indefensible with twelve thousand: the query reads every row, Rust builds every DTO, the IPC
//! layer serializes every one of them, and the table then renders twenty. The cost is paid in
//! full, on every keystroke that triggers a refresh, to show a fixed number of rows.
//!
//! Two rules make paging trustworthy rather than merely smaller:
//!
//!   * **Bounded.** A caller cannot ask for a million rows by passing `pageSize: 1000000`.
//!   * **Deterministic.** Ordering is always `created_at DESC, id DESC`. `created_at` alone is not
//!     a total order — two records written in the same second would tie, and SQLite is free to
//!     return them in either order, so a row could appear on page 1 and again on page 2 while
//!     another was never shown at all.

use serde::{Deserialize, Serialize};

/// The largest page a caller may ask for.
pub const MAX_PAGE_SIZE: u32 = 200;
/// What a caller gets when it asks for nothing in particular.
pub const DEFAULT_PAGE_SIZE: u32 = 50;
/// The most rows a selector search will return, however wide the query.
pub const MAX_SEARCH_RESULTS: u32 = 50;

/// What a caller asks for.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default, alias = "page_size")]
    pub page_size: Option<u32>,
    /// A case-insensitive substring match on the record's name.
    #[serde(default)]
    pub search: Option<String>,
}

/// A request with its bounds already applied.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedPage {
    /// One-based, as the interface counts pages.
    pub page: u32,
    pub page_size: u32,
    pub offset: i64,
    pub limit: i64,
}

impl PageRequest {
    /// Clamps the request into something safe to execute.
    ///
    /// A page of zero, a page size of zero, and a page size of a million are all things a caller
    /// can send; none of them should be able to make the backend do unbounded work.
    pub fn resolve(&self) -> ResolvedPage {
        let page = self.page.unwrap_or(1).max(1);
        let page_size = self
            .page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        ResolvedPage {
            page,
            page_size,
            offset: i64::from(page - 1) * i64::from(page_size),
            limit: i64::from(page_size),
        }
    }

    /// The `LIKE` pattern for the search term, or `None` when nothing was typed.
    pub fn like_pattern(&self) -> Option<String> {
        self.search
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| format!("%{}%", escape_like(text)))
    }
}

/// Escapes the wildcards SQLite's `LIKE` would otherwise interpret.
///
/// A user searching for `100%` means the three characters, not "anything after 100".
pub fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// One page of results, with enough context for a table to render its pager.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// How many rows match the filter in total — not how many are in `items`.
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
    /// True when another page exists after this one.
    pub has_more: bool,
}

impl<T> Page<T> {
    pub fn new(items: Vec<T>, total: i64, resolved: ResolvedPage) -> Self {
        let seen = resolved.offset + items.len() as i64;
        Self {
            items,
            total,
            page: resolved.page,
            page_size: resolved.page_size,
            has_more: seen < total,
        }
    }
}

/// One row of a selector: the id a payload needs and the words a person reads.
///
/// Deliberately tiny. A dropdown that loads whole `BaseOilDto`s to render a name is downloading a
/// viscosity table nobody is going to look at.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntityOption {
    pub id: String,
    pub label: String,
    /// A short qualifier — a base oil's type, an additive's molecule — or empty.
    pub detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_request_gets_the_default_first_page() {
        let resolved = PageRequest::default().resolve();
        assert_eq!(resolved.page, 1);
        assert_eq!(resolved.page_size, DEFAULT_PAGE_SIZE);
        assert_eq!(resolved.offset, 0);
    }

    #[test]
    fn a_page_size_larger_than_the_maximum_is_clamped_rather_than_honoured() {
        let request = PageRequest {
            page: Some(1),
            page_size: Some(1_000_000),
            search: None,
        };
        assert_eq!(request.resolve().page_size, MAX_PAGE_SIZE);
    }

    #[test]
    fn page_zero_is_read_as_the_first_page() {
        let request = PageRequest {
            page: Some(0),
            page_size: Some(10),
            search: None,
        };
        let resolved = request.resolve();
        assert_eq!(resolved.page, 1);
        assert_eq!(resolved.offset, 0);
    }

    #[test]
    fn the_offset_follows_the_page_and_its_size() {
        let request = PageRequest {
            page: Some(4),
            page_size: Some(25),
            search: None,
        };
        let resolved = request.resolve();
        assert_eq!(resolved.offset, 75);
        assert_eq!(resolved.limit, 25);
    }

    #[test]
    fn a_blank_search_term_is_no_search_at_all() {
        let request = PageRequest {
            page: None,
            page_size: None,
            search: Some("   ".to_string()),
        };
        assert_eq!(request.like_pattern(), None);
    }

    #[test]
    fn wildcards_a_user_typed_are_matched_literally() {
        let request = PageRequest {
            page: None,
            page_size: None,
            search: Some("100%".to_string()),
        };
        assert_eq!(request.like_pattern(), Some("%100\\%%".to_string()));
    }

    #[test]
    fn has_more_is_true_only_while_rows_remain() {
        let resolved = PageRequest {
            page: Some(1),
            page_size: Some(10),
            search: None,
        }
        .resolve();

        let full = Page::new((0..10).collect::<Vec<i32>>(), 25, resolved);
        assert!(full.has_more);

        let last = Page::new((0..10).collect::<Vec<i32>>(), 10, resolved);
        assert!(!last.has_more);
    }
}
