import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
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

export function registerCorrespondentTools(
  server: McpServer,
  api: PaperlessAPI
) {
  server.tool(
    "list_correspondents",
    "List all correspondents with optional filtering and pagination. Correspondents represent entities that send or receive documents.",
    {
      ...paginationFields,
      ...nameFilterFields,
      ordering: z.string().optional(),
      is_empty: z.boolean().optional().describe("Filter to only correspondents with 0 documents (true) or only those with >=1 document (false). Paginates through all results so the filter is global, not page-scoped."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { is_empty, ...apiArgs } = args;

      if (is_empty !== undefined) {
        return applyIsEmptyFilter(
          (qs) => api.getCorrespondents(qs),
          apiArgs,
          is_empty
        );
      }

      const queryString = buildQueryString(apiArgs);
      const response = await api.getCorrespondents(queryString);
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
    "get_correspondent",
    "Get a specific correspondent by ID with full details including matching rules.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.getCorrespondent(args.id);
      return {
        content: [
          { type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) },
        ],
      };
    })
  );

  server.tool(
    "create_correspondent",
    "Create a new correspondent with optional matching pattern and algorithm for automatic document assignment.",
    {
      name: z.string(),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.createCorrespondent(args);
      return {
        content: [
          { type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) },
        ],
      };
    })
  );

  server.tool(
    "update_correspondent",
    "Update fields on ONE correspondent (PATCH — only fields you supply are changed). Editable fields: name, match (matching pattern), matching_algorithm, is_insensitive. To assign this correspondent to documents, use edit_documents_bulk with method 'set_correspondent' or update_document instead.",
    {
      id: z.number(),
      name: z.string().optional(),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.updateCorrespondent(id, data);
      return {
        content: [
          { type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) },
        ],
      };
    })
  );

  server.tool(
    "delete_correspondent",
    "⚠️ DESTRUCTIVE: Permanently delete a correspondent from the entire system. This will affect ALL documents that use this correspondent.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteCorrespondent(args.id);
      return deletedResponse();
    })
  );

  registerBulkEditTool(server, api, {
    toolName: "edit_correspondents_bulk",
    description:
      "Manage correspondent objects themselves (permissions, delete). ⚠️ This does NOT assign correspondents to documents — use edit_documents_bulk with method 'set_correspondent' for that. WARNING: 'delete' permanently removes correspondents from the entire system.",
    idsField: "correspondent_ids",
    objectType: "correspondents",
  });
}
