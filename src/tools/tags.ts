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

export function registerTagTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_tags",
    "List all tags. IMPORTANT: When a user query may refer to a tag or document type, you should fetch all tags and all document types up front (with a large enough page_size), cache them for the session, and search locally for matches by name or slug before making further API calls. This reduces redundant requests and handles ambiguity between tags and document types efficiently.",
    {
      page: z.number().int().min(1).optional().describe("Page number (1-based)"),
      page_size: z.number().int().min(1).optional().describe("Number of items per page"),
      name__icontains: z.string().optional(),
      name__iendswith: z.string().optional(),
      name__iexact: z.string().optional(),
      name__istartswith: z.string().optional(),
      ordering: z.string().optional(),
      is_empty: z.boolean().optional().describe("Filter to only tags with 0 documents (true) or only those with >=1 document (false). Paginates through all results so the filter is global, not page-scoped."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      if (!api) throw new Error("Please configure API connection first");
      const { is_empty, ...apiArgs } = args;

      if (is_empty !== undefined) {
        const all = await fetchAllPages(
          (qs) => api.getTags(qs),
          apiArgs
        );
        const filtered = all.filter((t: any) =>
          is_empty ? t.document_count === 0 : t.document_count > 0
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
                all: enhanced.map((t: any) => t.id),
                results: enhanced,
              }),
            },
          ],
        };
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
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const response = await api.getTag(args.id);
      const enhancedTag = enhanceMatchingAlgorithm(response);
      return {
        content: [
          { type: "text", text: JSON.stringify(enhancedTag) },
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
      matching_algorithm: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe(MATCHING_ALGORITHM_DESCRIPTION),
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
      parent: z.number().nullable().optional().describe("Parent tag ID for hierarchical tags"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const tag = await api.createTag(args);
      const enhancedTag = enhanceMatchingAlgorithm(tag);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(enhancedTag),
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
      matching_algorithm: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe(MATCHING_ALGORITHM_DESCRIPTION),
      is_insensitive: z.boolean().optional().describe("Whether matching is case-insensitive"),
      parent: z.number().nullable().optional().describe("Parent tag ID for hierarchical tags"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      const { id, ...data } = args;
      const tag = await api.updateTag(id, data);
      const enhancedTag = enhanceMatchingAlgorithm(tag);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(enhancedTag),
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
    withErrorHandling(async (args, extra) => {
      if (!api) throw new Error("Please configure API connection first");
      if (!args.confirm) {
        throw new Error(
          "Confirmation required for destructive operation. Set confirm: true to proceed."
        );
      }
      await api.deleteTag(args.id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "deleted" }),
          },
        ],
      };
    })
  );

  server.tool(
    "bulk_edit_tags",
    "Manage tag objects themselves (permissions, delete). ⚠️ This does NOT add/remove tags on documents — use bulk_edit_documents with method 'add_tag'/'remove_tag'/'modify_tags' for that. WARNING: 'delete' permanently removes tags from the entire system.",
    {
      tag_ids: z.array(z.number()),
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
        args.tag_ids,
        "tags",
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
