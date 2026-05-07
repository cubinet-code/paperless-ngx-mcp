# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
