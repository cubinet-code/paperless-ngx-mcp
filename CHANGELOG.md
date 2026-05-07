# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.4] — 2026-05-07

> **Highlights:** This release fixes two long-standing bugs in `edit_documents_bulk` (formerly `bulk_edit_documents`) where `modify_custom_fields` always returned HTTP 400 and `set_permissions` always returned HTTP 500. It also renames every bulk operation to a verb-first naming scheme so that wildcard permission allowlists group cleanly by operation, drops a stale `Accept: …version=5` header pin, and adds the upstream `edit_pdf` bulk method. New schema-driven e2e tests now run against a live Paperless 2.20.15 container and will fail when upstream changes its API.

### Fixed

- **`edit_documents_bulk` method `modify_custom_fields` was always rejected by Paperless** with HTTP 400 `"add_custom_fields not specified"`. The wire payload now uses `add_custom_fields` (`{field_id: value}` dict, per upstream `BulkEditSerializer`) and `remove_custom_fields` (list of ids), and includes both keys whenever the method is `modify_custom_fields`. Previously the tool emitted `assign_custom_fields` / `assign_custom_fields_values`, neither of which the upstream serializer recognises. **Tool input shape is unchanged** — `add_custom_fields: [{field, value}, …]` still works and is now translated to the dict form on the wire.
- **`edit_documents_bulk` method `set_permissions` failed with HTTP 500.** `set_permissions`, `owner`, and `merge` are now top-level parameters on the tool (siblings of `documents` and `method`), matching the upstream `_validate_parameters_set_permissions` shape. The previous nested `permissions: {set_permissions, owner, merge}` wrapper has been removed.
- **`Accept: application/json; version=5`** header pin removed. The server defaults to its current API version (currently 9), so document, tag, and custom-field responses now include fields like `created` and `user` that v5 hid.

### Added

- **`edit_documents_bulk` method `edit_pdf`** is now exposed (added upstream in Paperless-NGX 2.16). Accepts `operations: [{page, rotate?, doc?}]`, plus optional `update_document` and `include_metadata` flags.
- **Schema-driven e2e tests** that fetch the live `/api/schema/` from a running Paperless container:
  - `tests/e2e/schema_coverage.e2e.test.ts` — fails when upstream adds, removes, or renames an endpoint, forcing a triage decision (wrap the new endpoint, or document the skip). Also verifies our `edit_documents_bulk` method enum stays in sync with upstream's `MethodEnum`.
  - `tests/e2e/bulk_edit.e2e.test.ts` — round-trips real `modify_custom_fields` and `set_permissions` payloads against a real container, asserting observable side effects (custom-field value applied, owner changed, etc.).
- E2e harness now applies each tool's Zod schema before invoking the body, so e2e tests exercise the full input pipeline (schema validation + body + API), the same way the real MCP SDK does.

### Changed

- **E2e Paperless container bumped from `2.13` to `2.20.15`** (latest stable). Required for `edit_pdf` and current OpenAPI schema coverage.

### Changed (BREAKING)

> If you upgrade and your AI agent or hand-written client makes bulk operations, **read this section**.

#### 1. Bulk-operation tool names are now verb-first

Tool names changed so that wildcard-based permission allowlists group cleanly by operation. Migrate any client config (Claude Code permissions, Codex allowlists, Cursor rules, hand-written allowlists) that references the old names:

| Old name | New name |
|---|---|
| `bulk_download` | `download_documents_bulk` |
| `bulk_edit_documents` | `edit_documents_bulk` |
| `bulk_edit_tags` | `edit_tags_bulk` |
| `bulk_edit_correspondents` | `edit_correspondents_bulk` |
| `bulk_edit_document_types` | `edit_document_types_bulk` |
| `bulk_edit_custom_fields` | `edit_custom_fields_bulk` |

Behaviour and parameters are unchanged — only the names. After upgrading, `download_*` covers single + bulk downloads and `edit_*_bulk` covers every bulk-edit family. See the README's "Tool naming convention" table for the recommended allowlist patterns.

#### 2. `edit_documents_bulk` `set_permissions` parameter shape

If you build `set_permissions` payloads by hand (vs. letting the LLM produce them), the wrapping `permissions:` object is gone and `set_permissions` / `owner` / `merge` are siblings at the top level.

```diff
  edit_documents_bulk({
    documents: [1, 2],
    method: "set_permissions",
-   permissions: {
-     set_permissions: { view: { users: [1] }, change: { users: [2] } },
-     owner: 1,
-     merge: false,
-   },
+   set_permissions: { view: { users: [1] }, change: { users: [2] } },
+   owner: 1,
+   merge: false,
  })
```

#### 3. `edit_documents_bulk` `modify_custom_fields`

The tool's **input shape is unchanged** (`add_custom_fields: [{field, value}, …]`, `remove_custom_fields: [id, …]`). What changed is the wire format: it used to silently fail with HTTP 400 on every call, and now succeeds. Anyone who had this method "working" against their server is on a custom fork.

## [0.1.3] — 2026-05-06

- Skip metadata fetches when no documents reference them.
- Add `triage_inbox` prompt and extract shared tool utilities.
- Lead Quick Start with npx-based install for Claude Code and Codex.
- Add issue and PR templates.

## [0.1.2] — 2026-05-06

- Auto-create GitHub Release on tag push.

## [0.1.1] — 2026-05-06

- Renovate dependencies and unblock SDK upgrade.

## [0.1.0] — 2026-05-06

- Initial release.
