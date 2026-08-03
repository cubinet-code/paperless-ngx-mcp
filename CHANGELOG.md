# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [3.0.0] — 2026-08-03

Adds support for **Paperless-ngx 3.x**, which reworked the task API. Paperless 2.x remains supported — the tools detect and adapt to either server.

The version jumps from `0.1.6` to `3.0.0` so the major tracks the Paperless-ngx major it targets. There are no `1.x` or `2.x` releases of this package.

### Fixed

- **`list_tasks` failed outright against Paperless 3.x.** 3.0 paginates `/api/tasks/` (`{count, next, previous, results}`); 2.x returned a bare array. The tool sliced the response directly and died with `response.slice is not a function`. Both shapes are now accepted and the tool still returns a plain array.
- **`post_document` with `poll: true` never completed against Paperless 3.x.** Two independent causes, both silent — the upload succeeded but the tool always reported a timeout with no `document_id`:
  - the consumer poll read `/api/tasks/?task_id=…` as an array, so it never found its task on 3.x;
  - terminal-state detection compared against uppercase `SUCCESS`/`FAILURE`/`REVOKED`, but 3.x reports lowercase `success`/`failure`/`revoked`. Status comparison is now case-insensitive.
- **`post_document` returned no `document_id` on Paperless 3.x** even when the consumer succeeded: 3.x replaced the task's `related_document` with a `related_document_ids` array. Both are now read.

### Added

- **`list_tasks` gained the Paperless 3.x filters `task_type` and `trigger_source`.** The 2.x `task_name` and `type` filters are kept for older servers. Each server silently ignores the filters it does not know, so the correct pair applies automatically; the tool descriptions say which version each belongs to.
- `task_type` covers the task kinds 3.x added: `mail_fetch`, `llm_index`, `empty_trash`, `check_workflows`, `bulk_update`, `reprocess_document`, `build_share_link`, `bulk_delete`. Note that 2.x's `check_sanity` is `sanity_check` in 3.x.

### Changed (BREAKING)

- **`list_tasks` `status` values are now lowercase** (`success`, not `SUCCESS`), matching the 3.x vocabulary. Paperless 2.x requires uppercase and rejects lowercase with a 400, so the tool retries with the other casing and remembers which the server accepted — callers pass lowercase either way.
- **`list_tasks` no longer accepts `status: "RETRY"` or `"RECEIVED"`.** Paperless 3.x removed both from the task status enum.
- **`post_document` reports the server's own status casing** in its result (`success` on 3.x, `SUCCESS` on 2.x) rather than always uppercasing it.

## [0.1.6] — 2026-06-29

### Added

- **`post_document` can now wait for the consumer.** New optional `poll` flag: when `true`, the tool waits for the Paperless consumer task to finish and returns the final result in a single call — the new `document_id` on success, or the consumer error (e.g. `InputFileError`) on failure — instead of just a task UUID you have to chase via `list_tasks`. New optional `poll_timeout_seconds` (default 30, max 300) caps the wait and returns the in-progress status on timeout; raise it for large scans where OCR is slow. Default behaviour is unchanged — without `poll`, the tool still returns the task UUID immediately.

### Fixed

- **`post_document` no longer misleads callers about the `file` path option on remote deployments.** The `file` parameter description now makes clear that base64 content is the universal method (the bytes travel over the wire) and that the absolute-path option only works when the MCP server runs on the same machine as the file (local/stdio deployments). When a path can't be read (e.g. a remote server can't see the caller's filesystem), the bare `ENOENT` is replaced with a message that explains why and tells the caller to pass base64 instead — so an AI client can self-correct instead of dead-ending.

## [0.1.5] — 2026-05-07

### Security

- Bumped transitive dependency `ip-address` to 10.2.0 (via `express-rate-limit` 8.5.1) to clear [GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g) — XSS in `Address6` HTML-emitting methods. The vulnerable methods were not reachable from this codebase, so no functional change; `npm audit` is now clean.

### Changed

- Release workflow now extracts release notes from the matching `## [<version>]` section of `CHANGELOG.md` and fails the release if that section is missing. Previous setup derived notes from PR titles, leaving release pages empty when work landed directly on `main` (as on v0.1.4).

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
