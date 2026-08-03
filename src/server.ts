import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { registerCorrespondentTools } from "./tools/correspondents";
import { registerCustomFieldTools } from "./tools/customFields";
import { registerDocumentTools } from "./tools/documents";
import { registerDocumentTypeTools } from "./tools/documentTypes";
import { registerPrompts } from "./tools/prompts";
import { registerSavedViewTools } from "./tools/savedViews";
import { registerShareLinkTools } from "./tools/shareLinks";
import { registerStoragePathTools } from "./tools/storagePaths";
import { registerSystemTools } from "./tools/system";
import { registerTagTools } from "./tools/tags";
import { registerWorkflowTools } from "./tools/workflows";
import { version } from "../package.json";

/**
 * Builds a fully-registered MCP server.
 *
 * An `McpServer` can only be connected to one transport at a time — the SDK's
 * `Protocol.connect()` throws otherwise — so every concurrent client needs its
 * own instance. The `PaperlessAPI` client holds no per-connection state and is
 * safe to share across them.
 */
export function createServer(
  api: PaperlessAPI,
  publicUrl: string | undefined
): McpServer {
  const server = new McpServer(
    { name: "paperless-ngx", version },
    {
      instructions: `
Paperless-NGX MCP Server Instructions

⚠️ CRITICAL: Always differentiate between operations on specific documents vs operations on the entire system:

- REMOVE operations (e.g., remove_tag in edit_documents_bulk): Affect only the specified documents, items remain in the system
- DELETE operations (e.g., delete_tag, delete_correspondent): Permanently delete items from the entire system, affecting ALL documents that use them

When a user asks to "remove" something, prefer operations that affect specific documents. Only use DELETE operations when explicitly asked to delete from the system.

To view documents in your Paperless-NGX web interface, construct URLs using this pattern:
${publicUrl}/documents/{document_id}/

Example: If your base URL is "http://localhost:8000", the web interface URL would be "http://localhost:8000/documents/123/" for document ID 123.

The document tools return JSON data with document IDs that you can use to construct these URLs.

Quick tool-selection guide:

| Want to… | Use |
|---|---|
| Edit fields (title, date, content, tags) on ONE document | update_document |
| Apply the same change to MANY documents at once | edit_documents_bulk |
| Add a comment/annotation to a document | create_document_note |
| Rename a tag/correspondent/document_type, or change its matching rules | update_tag / update_correspondent / update_document_type |
| Permanently delete a tag/correspondent/document_type system-wide | delete_tag / delete_correspondent / delete_document_type (destructive) |
| Find documents filtered by tag/correspondent/type/date | list_documents (after looking up the relevant ID) |
| Free-text search inside document content | search_documents |
      `,
    }
  );

  registerDocumentTools(server, api);
  registerTagTools(server, api);
  registerCorrespondentTools(server, api);
  registerDocumentTypeTools(server, api);
  registerCustomFieldTools(server, api);
  registerStoragePathTools(server, api);
  registerSavedViewTools(server, api);
  registerShareLinkTools(server, api);
  registerWorkflowTools(server, api);
  registerSystemTools(server, api);
  registerPrompts(server);

  return server;
}
