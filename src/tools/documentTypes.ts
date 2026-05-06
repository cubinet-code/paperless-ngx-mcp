import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { DocumentType } from "../api/types";
import {
  enhanceMatchingAlgorithm,
  enhanceMatchingAlgorithmArray,
} from "../api/utils";
import { Annotations } from "./utils/annotations";
import { registerBulkEditTool } from "./utils/bulkEdit";
import { applyIsEmptyFilter } from "./utils/listFilter";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import {
  matchingAlgorithmField,
  nameFilterFields,
  paginationFields,
} from "./utils/schemas";

export function registerDocumentTypeTools(
  server: McpServer,
  api: PaperlessAPI
) {
  server.tool(
    "list_document_types",
    "List all document types. IMPORTANT: When a user query may refer to a document type or tag, you should fetch all document types and all tags up front (with a large enough page_size), cache them for the session, and search locally for matches by name or slug before making further API calls. This reduces redundant requests and handles ambiguity between tags and document types efficiently.",
    {
      ...paginationFields,
      ...nameFilterFields,
      ordering: z.string().optional(),
      is_empty: z.boolean().optional().describe("Filter to only document types with 0 documents (true) or only those with >=1 document (false). Paginates through all results so the filter is global, not page-scoped."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { is_empty, ...apiArgs } = args;

      if (is_empty !== undefined) {
        return applyIsEmptyFilter(
          (qs) => api.getDocumentTypes(qs),
          apiArgs,
          is_empty
        );
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
    withErrorHandling(async (args) => {
      const response = await api.request<DocumentType>(
        `/document_types/${args.id}/`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
      };
    })
  );

  server.tool(
    "create_document_type",
    "Create a new document type with optional matching pattern and algorithm for automatic document classification.",
    {
      name: z.string(),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.createDocumentType(args);
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
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
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...payloadWithoutId } = args;
      const response = await api.updateDocumentType(id, payloadWithoutId);
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
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
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteDocumentType(args.id);
      return deletedResponse();
    })
  );

  registerBulkEditTool(server, api, {
    toolName: "bulk_edit_document_types",
    description:
      "Manage document type objects themselves (permissions, delete). ⚠️ This does NOT assign document types to documents — use bulk_edit_documents with method 'set_document_type' for that. WARNING: 'delete' permanently removes document types from the entire system.",
    idsField: "document_type_ids",
    objectType: "document_types",
  });
}
