# paperless-ngx-mcp

[![CI](https://github.com/cubinet-code/paperless-ngx-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/cubinet-code/paperless-ngx-mcp/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io/) server for [Paperless-NGX](https://docs.paperless-ngx.com/). Exposes the full Paperless-NGX REST API to AI assistants — documents, tags, correspondents, document types, custom fields, storage paths, saved views, share links, workflows, notes, trash, and tasks.

## Quick Start

```bash
git clone https://github.com/cubinet-code/paperless-ngx-mcp.git
cd paperless-ngx-mcp
npm install
npm run build
```

Add to your MCP client config (e.g. `~/.claude/.mcp.json`, or the equivalent for Cursor / Claude Desktop / Cline / etc.):

```json
{
  "mcpServers": {
    "paperless": {
      "command": "node",
      "args": ["/absolute/path/to/paperless-ngx-mcp/build/index.js"],
      "env": {
        "PAPERLESS_URL": "http://your-paperless-instance:8000",
        "PAPERLESS_API_KEY": "your-api-token",
        "PAPERLESS_PUBLIC_URL": "https://your-public-domain.com"
      }
    }
  }
}
```

### Get your Paperless-NGX API token

1. Log into your Paperless-NGX instance.
2. Click your username (top right) → **My Profile**.
3. Click the circular arrow button to generate a new token.

### Configuration

| Variable | Required | Purpose |
|---|---|---|
| `PAPERLESS_URL` | yes | Base URL the MCP server uses to talk to Paperless-NGX. |
| `PAPERLESS_API_KEY` | yes | API token (see above). |
| `PAPERLESS_PUBLIC_URL` | no | Public URL the assistant uses when constructing browser links to documents. Falls back to `PAPERLESS_URL`. |

CLI flags (`--baseUrl`, `--token`, `--publicUrl`, `--http`, `--port`) take precedence over environment variables.

### Example Usage

Things you can ask Claude (or any MCP-aware assistant):

- "Show me all documents tagged as 'Invoice'"
- "Search for documents containing 'tax return'"
- "Create a new tag called 'Receipts' with color #FF0000"
- "Download document #123"
- "List all correspondents"
- "Create a new document type called 'Bank Statement'"
- "Empty the trash"
- "Show me pending consumption tasks"

## Available Tools

The server registers tools across ten domains.

### Documents
`list_documents`, `get_document`, `get_document_content`, `search_documents`, `download_document`, `get_document_thumbnail`, `get_document_preview`, `get_document_history`, `get_document_metadata`, `update_document`, `post_document`, `email_document`, `bulk_edit_documents`, `delete_document`, `bulk_download`, `search_autocomplete`, `get_document_suggestions`, `get_next_asn`

### Tags
`list_tags`, `get_tag`, `create_tag`, `update_tag`, `delete_tag`, `bulk_edit_tags`

### Correspondents
`list_correspondents`, `get_correspondent`, `create_correspondent`, `update_correspondent`, `delete_correspondent`, `bulk_edit_correspondents`

### Document Types
`list_document_types`, `get_document_type`, `create_document_type`, `update_document_type`, `delete_document_type`, `bulk_edit_document_types`

### Custom Fields
`list_custom_fields`, `get_custom_field`, `create_custom_field`, `update_custom_field`, `delete_custom_field`, `bulk_edit_custom_fields`

### Storage Paths
`list_storage_paths`, `get_storage_path`, `create_storage_path`, `update_storage_path`, `delete_storage_path`, `test_storage_path`

### Saved Views
`list_saved_views`, `get_saved_view`, `create_saved_view`, `update_saved_view`, `delete_saved_view`

### Share Links
`list_share_links`, `list_document_share_links`, `get_share_link`, `create_share_link`, `update_share_link`, `delete_share_link`

### Workflows
`list_workflow_actions`, `get_workflow_action`, `create_workflow_action`, `update_workflow_action`, `delete_workflow_action`, `list_workflow_triggers`, `get_workflow_trigger`, `create_workflow_trigger`, `update_workflow_trigger`, `delete_workflow_trigger`

### System / Notes / Trash / Tasks
`get_statistics`, `list_document_notes`, `create_document_note`, `delete_document_note`, `list_trash`, `restore_from_trash`, `empty_trash`, `list_tasks`, `acknowledge_tasks`

### Notable tool details

#### `bulk_edit_documents`

Perform bulk operations on multiple documents.

Parameters:
- `documents`: array of document IDs
- `method`: one of `set_correspondent`, `set_document_type`, `set_storage_path`, `add_tag`, `remove_tag`, `modify_tags`, `modify_custom_fields`, `delete`, `reprocess`, `set_permissions`, `merge`, `split`, `rotate`, `delete_pages`
- Method-specific parameters: `correspondent`, `document_type`, `storage_path`, `tag`, `add_tags`, `remove_tags`, `add_custom_fields`, `remove_custom_fields`, `permissions`, `metadata_document_id`, `delete_originals`, `pages`, `degrees`

```typescript
// Add a tag to multiple documents
bulk_edit_documents({ documents: [1, 2, 3], method: "add_tag", tag: 5 })

// Merge documents
bulk_edit_documents({
  documents: [6, 7, 8],
  method: "merge",
  metadata_document_id: 6,
  delete_originals: true,
})

// Split a document into parts
bulk_edit_documents({ documents: [9], method: "split", pages: "[1-2,3-4,5]" })

// Modify multiple tags at once
bulk_edit_documents({
  documents: [10, 11],
  method: "modify_tags",
  add_tags: [1, 2],
  remove_tags: [3, 4],
})
```

#### `post_document`

Upload a new document.

Parameters: `file` (base64-encoded contents), `filename`, plus optional `title`, `created`, `correspondent`, `document_type`, `storage_path`, `tags`, `archive_serial_number`, `custom_fields`.

#### Matching algorithms

`create_tag`, `create_correspondent`, `create_document_type`, and `create_storage_path` accept a `matching_algorithm` (0–6):

| Value | Meaning |
|---|---|
| 0 | None |
| 1 | Any word |
| 2 | All words |
| 3 | Exact match |
| 4 | Regular expression |
| 5 | Fuzzy word |
| 6 | Automatic |

## Running the MCP Server

### stdio (default)

The default mode. The server communicates over stdio — suitable for direct integration with MCP clients like Claude Desktop / Claude Code / Cursor.

```bash
# via env vars (recommended for MCP client configs)
PAPERLESS_URL=http://localhost:8000 PAPERLESS_API_KEY=xxx node build/index.js

# or via CLI flags
node build/index.js --baseUrl http://localhost:8000 --token xxx
```

### HTTP (Streamable HTTP transport)

Use the `--http` flag to expose the server over HTTP. `--port` defaults to `3000`.

```bash
node build/index.js --baseUrl http://localhost:8000 --token xxx --http --port 3000
```

- The MCP API is available at `POST /mcp` on the chosen port.
- Each request is handled statelessly via [`StreamableHTTPServerTransport`](https://github.com/modelcontextprotocol/typescript-sdk).
- A legacy `GET /sse` + `POST /messages` SSE transport is also exposed for clients that don't yet support the streamable transport.

## Error Handling

Tool calls return clear errors when:
- `PAPERLESS_URL` or `PAPERLESS_API_KEY` is missing or wrong
- The Paperless-NGX server is unreachable
- The underlying API rejects the operation
- Tool parameters fail validation

## Development

```bash
npm install        # install dependencies
npm run start      # run the server with tsx (no build step)
npm run build      # compile TypeScript to build/
npm test           # unit tests (node:test + tsx)
npm run inspect    # build, then launch @modelcontextprotocol/inspector
```

`npm run start` accepts the same flags / env vars as the built binary.

### End-to-end tests

E2E tests spin up a real Paperless-NGX container via Docker Compose:

```bash
npm run test:e2e:up    # start the test stack (paperless + redis)
npm run test:e2e       # run the e2e suite against it
npm run test:e2e:down  # tear down and remove volumes
```

Built with:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server SDK
- [zod](https://github.com/colinhacks/zod) — schema validation
- [axios](https://github.com/axios/axios) — HTTP client (with keep-alive agents and a 60s timeout)

## API Documentation

This MCP server wraps endpoints from the Paperless-NGX REST API. See the [official API documentation](https://docs.paperless-ngx.com/api/) for details on the underlying behaviour and field semantics.

## License

ISC. See [LICENSE](LICENSE).
