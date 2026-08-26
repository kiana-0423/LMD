# Audit regression fixtures

Each file here reproduces a defect that reached production and that an earlier version of one of
the audits failed to detect:

| Fixture | Defect it reproduces | Audit that must catch it |
| --- | --- | --- |
| `handler_less_button.tsx.fixture` | A button that is only `disabled`, so pressing it does nothing | `check_no_placeholders.py` |
| `fabricated_table.tsx.fixture` | A scientific data table written as a literal instead of read from the database | `check_no_placeholders.py` |
| `mock_import.tsx.fixture` | A production component importing a browser-demo module | `check_no_placeholders.py` |
| `mock_path.tsx.fixture` | A fixed sample file path shown to a user | `check_no_placeholders.py` |
| `obsolete_phrase.ts.fixture` | A retired promise ("Molecule Design") reappearing in the interface | `check_no_placeholders.py` |
| `hardcoded_string.tsx.fixture` | A label typed into a component instead of looked up, so it ignores the language switch | `find_untranslated_strings.py` |

`scripts/test_check_no_placeholders.py` copies the scanned directories into a temporary tree, drops
one fixture in at a time, and asserts the right check fails. Nothing is ever written into — or
deleted from — the production source tree, which is why the self-test is safe to run alongside a
type-check or a build; the run finishes by comparing a checksum of every production source file
against the one it took at the start.

These files are never imported by the application. The `.fixture` suffix keeps them out of
TypeScript's program and out of Vite's module graph.
