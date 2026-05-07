# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`edit_documents_bulk` method `modify_custom_fields` was always rejected by Paperless** with HTTP 400 `"add_custom_fields not specified"`. The wire payload now uses `add_custom_fields` (`{field_id: value}` dict, per upstream `BulkEditSerializer`) and `remove_custom_fields` (list of ids), and includes both keys whenever the method is `modify_custom_fields`. Previously the tool emitted `assign_custom_fields` / `assign_custom_fields_values`, neither of which the upstream serializer recognises. Tool input shape is unchanged — `add_custom_fields: [{field, value}, ...]` still works and is now translated to the dict form on the wire.
- **`edit_documents_bulk` method `set_permissions` failed with HTTP 500.** `set_permissions`, `owner`, and `merge` are now top-level parameters on the tool (siblings of `documents` and `method`), matching the upstream `_validate_parameters_set_permissions` shape. The previous nested `permissions: {set_permissions, owner, merge}` wrapper has been removed.
- **`Accept: application/json; version=5`** header pin removed. The server defaults to its current API version (currently 9), so document/tag/custom-field responses now include `created`, `user`, and other fields that v5 hid.

### Added

- **`edit_documents_bulk` method `edit_pdf`** is now exposed (added upstream in 2.16). Accepts `operations: [{page, rotate?, doc?}]`, plus optional `update_document` and `include_metadata` flags.
- **Schema-driven e2e tests** that fetch the live `/api/schema/` from a running Paperless container:
  - `tests/e2e/schema_coverage.e2e.test.ts` — fails when upstream adds, removes, or renames an endpoint, forcing a triage decision (wrap or document the skip). Also verifies our `edit_documents_bulk` method enum stays in sync with upstream's `MethodEnum`.
  - `tests/e2e/bulk_edit.e2e.test.ts` — round-trips real `modify_custom_fields` and `set_permissions` payloads against the container, asserting observable side effects.
- E2e harness now applies each tool's Zod schema before invoking the body, so e2e tests exercise the full input pipeline (schema + body + API).

### Changed

- **E2e Paperless container bumped from `2.13` to `2.20.15`** (latest stable). Required for `edit_pdf` and current OpenAPI schema coverage.

### Changed (BREAKING)

- **Bulk-operation tool names are now verb-first** so wildcard-based permission allowlists group cleanly by operation. Migrate any client config (Claude Code permissions, Codex allowlists, Cursor rules, hand-written allowlists) that references the old names:

  | Old name | New name |
  |---|---|
  | `bulk_download` | `download_documents_bulk` |
  | `bulk_edit_documents` | `edit_documents_bulk` |
  | `bulk_edit_tags` | `edit_tags_bulk` |
  | `bulk_edit_correspondents` | `edit_correspondents_bulk` |
  | `bulk_edit_document_types` | `edit_document_types_bulk` |
  | `bulk_edit_custom_fields` | `edit_custom_fields_bulk` |

  Behaviour and parameters are unchanged — only the tool names. After upgrading, `download_*` covers single + bulk downloads and `edit_*_bulk` covers every bulk-edit family. See the README's "Tool naming convention" table for the recommended allowlist patterns.

- **`edit_documents_bulk` parameter shape changed for two methods.** If you build payloads by hand (vs. letting the LLM produce them), update them:
  - `set_permissions`: was `{permissions: {set_permissions, owner, merge}}`, now `{set_permissions, owner, merge}` at the top level.
  - `modify_custom_fields`: input shape unchanged (`add_custom_fields: [{field, value}]`), but the previously-broken wire format is now correct — calls that used to silently fail will now succeed.

## [0.1.3] — 2026-01-XX

- Skip metadata fetches when no documents reference them.
- Add `triage_inbox` prompt and extract shared tool utilities.
- Lead Quick Start with npx-based install for Claude Code and Codex.
- Add issue and PR templates.

## [0.1.2] — earlier

- Auto-create GitHub Release on tag push.

## [0.1.1] — earlier

- Renovate dependencies and unblock SDK upgrade.

## [0.1.0] — initial release
