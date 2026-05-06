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

export function registerTagTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_tags",
    "List all tags. IMPORTANT: When a user query may refer to a tag or document type, you should fetch all tags and all document types up front (with a large enough page_size), cache them for the session, and search locally for matches by name or slug before making further API calls. This reduces redundant requests and handles ambiguity between tags and document types efficiently.",
    {
      ...paginationFields,
      ...nameFilterFields,
      ordering: z.string().optional(),
      is_empty: z.boolean().optional().describe("Filter to only tags with 0 documents (true) or only those with >=1 document (false). Paginates through all results so the filter is global, not page-scoped."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { is_empty, ...apiArgs } = args;

      if (is_empty !== undefined) {
        return applyIsEmptyFilter(
          (qs) => api.getTags(qs),
          apiArgs,
          is_empty
        );
      }

      const queryString = buildQueryString(apiArgs);
      const tagsResponse = await api.getTags(queryString);
      const enhancedResults = enhanceMatchingAlgorithmArray(tagsResponse.results || []);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...tagsResponse,
              results: enhancedResults,
            }),
          },
        ],
      };
    })
  );

  server.tool(
    "get_tag",
    "Get a specific tag by ID with full details including matching rules.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.getTag(args.id);
      return {
        content: [
          { type: "text", text: JSON.stringify(enhanceMatchingAlgorithm(response)) },
        ],
      };
    })
  );

  server.tool(
    "create_tag",
    "Create a new tag with optional color, matching pattern, and matching algorithm for automatic document tagging.",
    {
      name: z.string(),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
      parent: z.number().nullable().optional().describe("Parent tag ID for hierarchical tags"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const tag = await api.createTag(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(enhanceMatchingAlgorithm(tag)),
          },
        ],
      };
    })
  );

  server.tool(
    "update_tag",
    "Update fields on ONE tag (PATCH — only fields you supply are changed). Editable fields: name, color, match (matching pattern), matching_algorithm, is_insensitive, parent (parent tag ID for hierarchy). To add or remove this tag on documents, use bulk_edit_documents with method 'add_tag' / 'remove_tag' / 'modify_tags' instead.",
    {
      id: z.number(),
      name: z.string().optional(),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      match: z.string().optional(),
      matching_algorithm: matchingAlgorithmField,
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
      parent: z.number().nullable().optional().describe("Parent tag ID for hierarchical tags"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const tag = await api.updateTag(id, data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(enhanceMatchingAlgorithm(tag)),
          },
        ],
      };
    })
  );

  server.tool(
    "delete_tag",
    "⚠️ DESTRUCTIVE: Permanently delete a tag from the entire system. This will remove the tag from ALL documents that use it. Use with extreme caution.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteTag(args.id);
      return deletedResponse();
    })
  );

  registerBulkEditTool(server, api, {
    toolName: "bulk_edit_tags",
    description:
      "Manage tag objects themselves (permissions, delete). ⚠️ This does NOT add/remove tags on documents — use bulk_edit_documents with method 'add_tag'/'remove_tag'/'modify_tags' for that. WARNING: 'delete' permanently removes tags from the entire system.",
    idsField: "tag_ids",
    objectType: "tags",
  });
}
