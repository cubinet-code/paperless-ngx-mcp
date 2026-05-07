import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import {
  enhanceMatchingAlgorithm,
  enhanceMatchingAlgorithmArray,
} from "../api/utils";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import {
  matchingAlgorithmField,
  nameFilterFields,
  paginationFields,
} from "./utils/schemas";

export function registerStoragePathTools(
  server: McpServer,
  api: PaperlessAPI
) {
  server.tool(
    "list_storage_paths",
    "List all storage paths with optional filtering and pagination. Storage paths define where documents are stored on disk.",
    {
      ...paginationFields,
      ...nameFilterFields,
      ordering: z.string().optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.getStoragePaths(queryString || undefined);
      const enhancedResults = enhanceMatchingAlgorithmArray(
        response.results || []
      );
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
    "get_storage_path",
    "Get a specific storage path by ID with full details including matching rules.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.getStoragePath(args.id);
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
      };
    })
  );

  server.tool(
    "create_storage_path",
    "Create a new storage path with a name, path template, and optional matching rules.",
    {
      name: z.string(),
      path: z.string().describe("The path template, e.g. '{{ created_year }}/{{ correspondent }}/{{ title }}'"),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.createStoragePath(args);
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
      };
    })
  );

  server.tool(
    "update_storage_path",
    "Update fields on ONE storage path (PATCH — only fields you supply are changed). Editable fields: name, path (path template), match (matching pattern), matching_algorithm, is_insensitive. To assign this storage path to documents, use edit_documents_bulk with method 'set_storage_path' or update_document instead.",
    {
      id: z.number(),
      name: z.string().optional(),
      path: z.string().optional().describe("The path template"),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.updateStoragePath(id, data);
      return {
        content: [{ type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) }],
      };
    })
  );

  server.tool(
    "delete_storage_path",
    "⚠️ DESTRUCTIVE: Permanently delete a storage path from the entire system. This will affect ALL documents that use this storage path.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteStoragePath(args.id);
      return deletedResponse();
    })
  );

  server.tool(
    "test_storage_path",
    "Test a storage path template to see how it would resolve for documents. Useful for validating path templates before creating or updating storage paths.",
    {
      name: z.string().describe("Storage path name"),
      path: z
        .string()
        .describe(
          "The path template to test, e.g. '{{ created_year }}/{{ correspondent }}/{{ title }}'"
        ),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request("/storage_paths/test/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );
}
