import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { MATCHING_ALGORITHM_DESCRIPTION } from "../api/types";
import {
  enhanceMatchingAlgorithm,
  enhanceMatchingAlgorithmArray,
} from "../api/utils";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { fetchAllPages } from "./utils/paginate";
import { buildQueryString } from "./utils/queryString";

export function registerDocumentTypeTools(
  server: McpServer,
  api: PaperlessAPI
) {
  server.tool(
    "list_document_types",
    "List all document types. IMPORTANT: When a user query may refer to a document type or tag, you should fetch all document types and all tags up front (with a large enough page_size), cache them for the session, and search locally for matches by name or slug before making further API calls. This reduces redundant requests and handles ambiguity between tags and document types efficiently.",
    {
      page: z.number().int().min(1).optional().describe("Page number (1-based)"),
      page_size: z.number().int().min(1).optional().describe("Number of items per page"),
      name__icontains: z.string().optional(),
      name__iendswith: z.string().optional(),
      name__iexact: z.string().optional(),
      name__istartswith: z.string().optional(),
      ordering: z.string().optional(),
      is_empty: z.boolean().optional().describe("Filter to only document types with 0 documents (true) or only those with >=1 document (false). Paginates through all results so the filter is global, not page-scoped."),
    },
    Annotations.READ,
    withErrorHandling(async (args = {}, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const { is_empty, ...apiArgs } = args;

      if (is_empty !== undefined) {
        const all = await fetchAllPages(
          (qs) => api.getDocumentTypes(qs),
          apiArgs
        );
        const filtered = all.filter((dt: any) =>
          is_empty ? dt.document_count === 0 : dt.document_count > 0
        );
        const enhanced = enhanceMatchingAlgorithmArray(filtered);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: enhanced.length,
                next: null,
                previous: null,
                all: enhanced.map((dt: any) => dt.id),
                results: enhanced,
              }),
            },
          ],
        };
      }

      const queryString = buildQueryString(apiArgs);
      const response = await api.getDocumentTypes(queryString);
      const enhancedResults = enhanceMatchingAlgorithmArray(response.results || []);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...response,
              results: enhancedResults,
            }),
          },
        ],
      };
    })
  );

  server.tool(
    "get_document_type",
    "Get a specific document type by ID with full details including matching rules.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const response = await api.request(`/document_types/${args.id}/`);
      const enhancedDocumentType = enhanceMatchingAlgorithm(response);
      return {
        content: [{ type: "text", text: JSON.stringify(enhancedDocumentType) }],
      };
    })
  );

  server.tool(
    "create_document_type",
    "Create a new document type with optional matching pattern and algorithm for automatic document classification.",
    {
      name: z.string(),
      match: z.string().optional(),
      matching_algorithm: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe(MATCHING_ALGORITHM_DESCRIPTION),
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const response = await api.createDocumentType(args);
      const enhancedDocumentType = enhanceMatchingAlgorithm(response);
      return {
        content: [{ type: "text", text: JSON.stringify(enhancedDocumentType) }],
      };
    })
  );

  server.tool(
    "update_document_type",
    "Update fields on ONE document type (PATCH — only fields you supply are changed). Editable fields: name, match (matching pattern), matching_algorithm, is_insensitive. To assign this document type to documents, use bulk_edit_documents with method 'set_document_type' or update_document instead.",
    {
      id: z.number(),
      name: z.string().optional(),
      match: z.string().optional(),
      matching_algorithm: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe(MATCHING_ALGORITHM_DESCRIPTION),
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const { id, ...payloadWithoutId } = args;
      const response = await api.updateDocumentType(id, payloadWithoutId);
      const enhancedDocumentType = enhanceMatchingAlgorithm(response);
      return {
        content: [{ type: "text", text: JSON.stringify(enhancedDocumentType) }],
      };
    })
  );

  server.tool(
    "delete_document_type",
    "⚠️ DESTRUCTIVE: Permanently delete a document type from the entire system. This will affect ALL documents that use this type.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      if (!args.confirm) {
        throw new Error(
          "Confirmation required for destructive operation. Set confirm: true to proceed."
        );
      }
      await api.deleteDocumentType(args.id);
      return {
        content: [
          { type: "text", text: JSON.stringify({ status: "deleted" }) },
        ],
      };
    })
  );

  server.tool(
    "bulk_edit_document_types",
    "Manage document type objects themselves (permissions, delete). ⚠️ This does NOT assign document types to documents — use bulk_edit_documents with method 'set_document_type' for that. WARNING: 'delete' permanently removes document types from the entire system.",
    {
      document_type_ids: z.array(z.number()),
      operation: z.enum(["set_permissions", "delete"]),
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Must be true when operation is 'delete' to confirm destructive operation"
        ),
      owner: z.number().optional(),
      permissions: z
        .object({
          view: z.object({
            users: z.array(z.number()).optional(),
            groups: z.array(z.number()).optional(),
          }),
          change: z.object({
            users: z.array(z.number()).optional(),
            groups: z.array(z.number()).optional(),
          }),
        })
        .optional(),
      merge: z.boolean().optional(),
    },
    Annotations.BULK_EDIT,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      if (args.operation === "delete" && !args.confirm) {
        throw new Error(
          "Confirmation required for destructive operation. Set confirm: true to proceed."
        );
      }
      return api.bulkEditObjects(
        args.document_type_ids,
        "document_types",
        args.operation,
        args.operation === "set_permissions"
          ? {
              owner: args.owner,
              permissions: args.permissions,
              merge: args.merge,
            }
          : {}
      );
    })
  );
}
