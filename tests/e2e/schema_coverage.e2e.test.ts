import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { z } from "zod";
import { registerDocumentTools } from "../../src/tools/documents";
import { createMockApi, createMockServer } from "../../src/tools/test-helpers";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

function getOurBulkEditMethodEnum(): string[] {
  const { server, tools } = createMockServer();
  registerDocumentTools(server, createMockApi({}));
  const shape = tools.get("edit_documents_bulk")!.schema as z.ZodRawShape;
  const methodSchema = shape.method as z.ZodEnum<Record<string, string>>;
  return Object.values(methodSchema.enum);
}

/**
 * Coverage inventory for /api/schema/. Each (path, method) pair must be
 * categorised. New endpoints introduced upstream surface as a failing test
 * that lists the unknowns — at which point the dev decides whether to wrap
 * the endpoint (move to WRAPPED) or document the skip (move to SKIPPED).
 */

interface SkipEntry {
  reason: string;
}

const WRAPPED = new Set<string>([
  // bulk_edit_objects (tag/correspondent/document_type/custom_field bulk delete + permissions)
  "POST /api/bulk_edit_objects/",

  // correspondents
  "GET /api/correspondents/",
  "POST /api/correspondents/",
  "GET /api/correspondents/{id}/",
  "PATCH /api/correspondents/{id}/",
  "DELETE /api/correspondents/{id}/",

  // custom_fields
  "GET /api/custom_fields/",
  "POST /api/custom_fields/",
  "GET /api/custom_fields/{id}/",
  "PATCH /api/custom_fields/{id}/",
  "DELETE /api/custom_fields/{id}/",

  // document_types
  "GET /api/document_types/",
  "POST /api/document_types/",
  "GET /api/document_types/{id}/",
  "PATCH /api/document_types/{id}/",
  "DELETE /api/document_types/{id}/",

  // documents (collection + actions)
  "GET /api/documents/",
  "POST /api/documents/bulk_download/",
  "POST /api/documents/bulk_edit/",
  "POST /api/documents/post_document/",
  "GET /api/documents/next_asn/",

  // documents/{id}/* (per-document)
  "GET /api/documents/{id}/",
  "PATCH /api/documents/{id}/",
  "DELETE /api/documents/{id}/",
  "GET /api/documents/{id}/download/",
  "POST /api/documents/{id}/email/",
  "GET /api/documents/{id}/history/",
  "GET /api/documents/{id}/metadata/",
  "GET /api/documents/{id}/notes/",
  "POST /api/documents/{id}/notes/",
  "DELETE /api/documents/{id}/notes/",
  "GET /api/documents/{id}/preview/",
  "GET /api/documents/{id}/share_links/",
  "GET /api/documents/{id}/suggestions/",
  "GET /api/documents/{id}/thumb/",

  // saved_views
  "GET /api/saved_views/",
  "POST /api/saved_views/",
  "GET /api/saved_views/{id}/",
  "PATCH /api/saved_views/{id}/",
  "DELETE /api/saved_views/{id}/",

  // search
  "GET /api/search/autocomplete/",

  // share_links
  "GET /api/share_links/",
  "POST /api/share_links/",
  "GET /api/share_links/{id}/",
  "DELETE /api/share_links/{id}/",

  // statistics
  "GET /api/statistics/",

  // storage_paths
  "GET /api/storage_paths/",
  "POST /api/storage_paths/",
  "POST /api/storage_paths/test/",
  "GET /api/storage_paths/{id}/",
  "PATCH /api/storage_paths/{id}/",
  "DELETE /api/storage_paths/{id}/",

  // tags
  "GET /api/tags/",
  "POST /api/tags/",
  "GET /api/tags/{id}/",
  "PATCH /api/tags/{id}/",
  "DELETE /api/tags/{id}/",

  // tasks
  "GET /api/tasks/",
  "POST /api/tasks/acknowledge/",

  // trash
  "GET /api/trash/",
  "POST /api/trash/",

  // workflow_actions
  "GET /api/workflow_actions/",
  "POST /api/workflow_actions/",
  "GET /api/workflow_actions/{id}/",
  "PATCH /api/workflow_actions/{id}/",
  "DELETE /api/workflow_actions/{id}/",

  // workflow_triggers
  "GET /api/workflow_triggers/",
  "POST /api/workflow_triggers/",
  "GET /api/workflow_triggers/{id}/",
  "PATCH /api/workflow_triggers/{id}/",
  "DELETE /api/workflow_triggers/{id}/",
]);

const SKIPPED: Record<string, SkipEntry> = {
  // PUT replaces PATCH semantics; we only wrap PATCH.
  "PUT /api/correspondents/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/custom_fields/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/document_types/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/documents/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/saved_views/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/storage_paths/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/tags/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/workflow_actions/{id}/": { reason: "PATCH-only by design" },
  "PUT /api/workflow_triggers/{id}/": { reason: "PATCH-only by design" },

  // Server / admin endpoints, not user-facing for an MCP agent.
  "GET /api/config/": { reason: "server-level config admin" },
  "GET /api/config/{id}/": { reason: "server-level config admin" },
  "PUT /api/config/{id}/": { reason: "server-level config admin" },
  "PATCH /api/config/{id}/": { reason: "server-level config admin" },
  "DELETE /api/config/{id}/": { reason: "server-level config admin" },
  "GET /api/logs/": { reason: "server logs" },
  "GET /api/logs/{id}/": { reason: "server logs" },
  "GET /api/remote_version/": { reason: "server version probe" },
  "GET /api/status/": { reason: "server health probe" },
  "POST /api/tasks/run/": { reason: "admin task trigger" },
  "GET /api/tasks/{id}/": { reason: "covered by list_tasks" },
  "POST /api/token/": { reason: "auth token mint, not a user-facing tool" },

  // User/group/profile admin — out of scope for document workflows.
  "GET /api/groups/": { reason: "user/group admin" },
  "POST /api/groups/": { reason: "user/group admin" },
  "GET /api/groups/{id}/": { reason: "user/group admin" },
  "PUT /api/groups/{id}/": { reason: "user/group admin" },
  "PATCH /api/groups/{id}/": { reason: "user/group admin" },
  "DELETE /api/groups/{id}/": { reason: "user/group admin" },
  "GET /api/users/": { reason: "user admin" },
  "POST /api/users/": { reason: "user admin" },
  "GET /api/users/{id}/": { reason: "user admin" },
  "PUT /api/users/{id}/": { reason: "user admin" },
  "PATCH /api/users/{id}/": { reason: "user admin" },
  "DELETE /api/users/{id}/": { reason: "user admin" },
  "POST /api/users/{id}/deactivate_totp/": { reason: "user admin" },
  "GET /api/profile/": { reason: "current-user profile admin" },
  "PATCH /api/profile/": { reason: "current-user profile admin" },
  "POST /api/profile/disconnect_social_account/": { reason: "current-user profile admin" },
  "POST /api/profile/generate_auth_token/": { reason: "current-user profile admin" },
  "GET /api/profile/social_account_providers/": { reason: "current-user profile admin" },
  "GET /api/profile/totp/": { reason: "current-user profile admin" },
  "POST /api/profile/totp/": { reason: "current-user profile admin" },
  "DELETE /api/profile/totp/": { reason: "current-user profile admin" },
  "GET /api/oauth/callback/": { reason: "OAuth callback, not a user tool" },

  // Mail ingestion / processed-mail history — server-side ingestion config.
  "GET /api/mail_accounts/": { reason: "mail ingestion config" },
  "POST /api/mail_accounts/": { reason: "mail ingestion config" },
  "POST /api/mail_accounts/test/": { reason: "mail ingestion config" },
  "GET /api/mail_accounts/{id}/": { reason: "mail ingestion config" },
  "PUT /api/mail_accounts/{id}/": { reason: "mail ingestion config" },
  "PATCH /api/mail_accounts/{id}/": { reason: "mail ingestion config" },
  "DELETE /api/mail_accounts/{id}/": { reason: "mail ingestion config" },
  "POST /api/mail_accounts/{id}/process/": { reason: "mail ingestion config" },
  "GET /api/mail_rules/": { reason: "mail ingestion config" },
  "POST /api/mail_rules/": { reason: "mail ingestion config" },
  "GET /api/mail_rules/{id}/": { reason: "mail ingestion config" },
  "PUT /api/mail_rules/{id}/": { reason: "mail ingestion config" },
  "PATCH /api/mail_rules/{id}/": { reason: "mail ingestion config" },
  "DELETE /api/mail_rules/{id}/": { reason: "mail ingestion config" },
  "GET /api/processed_mail/": { reason: "mail ingestion history" },
  "GET /api/processed_mail/{id}/": { reason: "mail ingestion history" },
  "POST /api/processed_mail/bulk_delete/": { reason: "mail ingestion history" },

  // UI customization — not a tool surface.
  "GET /api/ui_settings/": { reason: "UI customization" },
  "POST /api/ui_settings/": { reason: "UI customization" },

  // Misc. server-side helpers.
  "POST /api/documents/email/": {
    reason: "bulk email by query; we wrap per-document email at /{id}/email/",
  },
  "POST /api/documents/selection_data/": {
    reason: "UI helper for selection-state, not useful for an MCP agent",
  },
  "GET /api/search/": {
    reason: "global search; we use /documents/?query= instead",
  },

  // Top-level workflows resource — we wrap the inner actions/triggers, full
  // workflow CRUD is a future addition.
  "GET /api/workflows/": { reason: "future: full workflow CRUD" },
  "POST /api/workflows/": { reason: "future: full workflow CRUD" },
  "GET /api/workflows/{id}/": { reason: "future: full workflow CRUD" },
  "PUT /api/workflows/{id}/": { reason: "future: full workflow CRUD" },
  "PATCH /api/workflows/{id}/": { reason: "future: full workflow CRUD" },
  "DELETE /api/workflows/{id}/": { reason: "future: full workflow CRUD" },
};

interface SchemaDoc {
  paths: Record<string, Record<string, unknown>>;
}

describe("schema coverage (e2e) — every API endpoint is wrapped or explicitly skipped", () => {
  let schema: SchemaDoc;
  let live: Set<string>;

  before(async () => {
    const res = await axios.get<SchemaDoc>(`${BASE_URL}/api/schema/`, {
      headers: { Accept: "application/json" },
      params: { format: "json" },
      timeout: 10_000,
    });
    schema = res.data;
    live = new Set<string>();
    for (const [path, methods] of Object.entries(schema.paths)) {
      for (const method of Object.keys(methods)) {
        if (method === "parameters") continue;
        live.add(`${method.toUpperCase()} ${path}`);
      }
    }
  });

  test("every (path, method) in the schema is in WRAPPED or SKIPPED", () => {
    const unknown = [...live]
      .filter((entry) => !WRAPPED.has(entry) && !(entry in SKIPPED))
      .sort();

    assert.deepEqual(
      unknown,
      [],
      `New API endpoints detected. Move each to WRAPPED (and add a tool) or to SKIPPED (with reason):\n${unknown.join("\n")}`
    );
  });

  test("every entry in WRAPPED exists in the live schema (no dead allowlist entries)", () => {
    const removed = [...WRAPPED].filter((entry) => !live.has(entry)).sort();

    assert.deepEqual(
      removed,
      [],
      `Endpoints removed upstream (still in WRAPPED):\n${removed.join("\n")}`
    );
  });

  test("every entry in SKIPPED exists in the live schema (no dead allowlist entries)", () => {
    const removed = Object.keys(SKIPPED)
      .filter((entry) => !live.has(entry))
      .sort();

    assert.deepEqual(
      removed,
      [],
      `Endpoints removed upstream (still in SKIPPED):\n${removed.join("\n")}`
    );
  });

  test("BulkEditSerializer.method enum matches our edit_documents_bulk method enum", () => {
    const components = (
      schema as unknown as { components: { schemas: Record<string, unknown> } }
    ).components.schemas;

    const methodEnum = components["MethodEnum"] as
      | { enum?: string[] }
      | undefined;
    const upstreamMethods = methodEnum?.enum;
    assert.ok(
      Array.isArray(upstreamMethods) && upstreamMethods.length > 0,
      "schema is missing components.schemas.MethodEnum.enum"
    );

    const ourMethods = getOurBulkEditMethodEnum();
    const missing = upstreamMethods!.filter((m) => !ourMethods.includes(m));
    const extra = ourMethods.filter((m) => !upstreamMethods!.includes(m));

    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `method enum drift: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`
    );
  });
});
