import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { paginationFields } from "./utils/schemas";

export function registerShareLinkTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_share_links",
    "List all share links with optional filtering by creation date, expiration date, and pagination.",
    {
      ...paginationFields,
      ordering: z.string().optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/share_links/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_share_link",
    "Get a specific share link by ID with full details.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/share_links/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_share_link",
    "Create a share link for a document. Optionally set an expiration date and file version (archive or original). Share links can't be edited afterwards — to change the expiry, delete and recreate. To share several documents as one ZIP link, use create_share_link_bundle.",
    {
      document: z.number().describe("The document ID to share"),
      expiration: z
        .string()
        .nullable()
        .optional()
        .describe("Expiration date-time in ISO format, or null for no expiry"),
      file_version: z
        .enum(["archive", "original"])
        .optional()
        .describe("Which file version to share (default: archive)"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/share_links/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_share_link",
    "⚠️ DESTRUCTIVE: Permanently delete a share link. The shared URL will stop working.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/share_links/${args.id}/`, { method: "DELETE" });
      return deletedResponse();
    })
  );

  server.tool(
    "list_document_share_links",
    "List all share links for a specific document.",
    {
      id: z.number().describe("The document ID"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(
        `/documents/${args.id}/share_links/`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "list_share_link_bundles",
    "List share link bundles (one public link to a ZIP of several documents) with optional status filter and pagination.",
    {
      ...paginationFields,
      ordering: z.string().optional(),
      status: z.enum(["pending", "processing", "ready", "failed"]).optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/share_link_bundles/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_share_link_bundle",
    "Get one share link bundle, including its build status (pending → processing → ready or failed), size and last_error.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/share_link_bundles/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_share_link_bundle",
    "Create ONE public share link for a ZIP of several documents. The ZIP is built in the background: the bundle starts as status 'pending' and becomes usable once get_share_link_bundle reports 'ready'. The `slug` identifies the public link.",
    {
      document_ids: z.array(z.number()).min(1).describe("Documents to include"),
      expiration_days: z.number().int().min(1).nullable().optional().describe("Days until the link expires; omit or null for no expiry"),
      file_version: z.enum(["archive", "original"]).optional().describe("Which file of each document to include (default archive)"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/share_link_bundles/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "rebuild_share_link_bundle",
    "Re-queue a share link bundle's ZIP build, e.g. after it failed or its documents changed. The link (slug) stays the same.",
    { id: z.number() },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const response = await api.request(`/share_link_bundles/${args.id}/rebuild/`, {
        method: "POST",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_share_link_bundle",
    "⚠️ DESTRUCTIVE: Permanently delete a share link bundle. Its public link stops working; the documents are not affected.",
    {
      id: z.number(),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/share_link_bundles/${args.id}/`, { method: "DELETE" });
      return deletedResponse();
    })
  );
}
