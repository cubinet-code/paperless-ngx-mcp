import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { nameFilterFields, paginationFields } from "./utils/schemas";

export function registerCustomFieldTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_custom_fields",
    "List all custom fields. IMPORTANT: When a user query may refer to a custom field, you should fetch all custom fields up front (with a large enough page_size), cache them for the session, and search locally for matches by name before making further API calls. This reduces redundant requests and handles ambiguity efficiently.",
    {
      ...paginationFields,
      ...nameFilterFields,
      ordering: z.string().optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.getCustomFields(queryString);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    })
  );

  server.tool(
    "get_custom_field",
    "Get a specific custom field by ID with full details including data type and extra configuration.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.getCustomField(args.id);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_custom_field",
    "Create a new custom field with a specified data type (string, url, date, boolean, integer, float, monetary, documentlink, or select). For monetary fields, values must use currency code prefix format (e.g., USD10.00, GBP123.45) — NOT trailing symbol format (e.g., 10.00$).",
    {
      name: z.string(),
      data_type: z.enum([
        "string",
        "url",
        "date",
        "boolean",
        "integer",
        "float",
        "monetary",
        "documentlink",
        "select",
      ]),
      extra_data: z.record(z.string(), z.unknown()).nullable().optional(),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.createCustomField(args);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "update_custom_field",
    "Update fields on ONE custom field definition (PATCH — only fields you supply are changed). Editable fields: name, data_type, extra_data. ⚠️ Changing data_type on a field that already has values on documents may render those values invalid or unreadable — change data_type only on unused fields. To set a custom-field VALUE on a document, use update_document or edit_documents_bulk with method 'modify_custom_fields' instead.",
    {
      id: z.number(),
      name: z.string().optional(),
      data_type: z
        .enum([
          "string",
          "url",
          "date",
          "boolean",
          "integer",
          "float",
          "monetary",
          "documentlink",
          "select",
        ])
        .optional(),
      extra_data: z.record(z.string(), z.unknown()).nullable().optional(),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.updateCustomField(id, data);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_custom_field",
    "⚠️ DESTRUCTIVE: Permanently delete a custom field from the entire system. This will remove the field from ALL documents that use it.",
    {
      id: z.number(),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteCustomField(args.id);
      return deletedResponse();
    })
  );

  server.tool(
    "edit_custom_fields_bulk",
    "Manage custom field definitions themselves (permissions, delete). ⚠️ This does NOT modify custom field values on documents — use edit_documents_bulk with method 'modify_custom_fields' for that. WARNING: 'delete' permanently removes custom fields from the entire system.",
    {
      custom_fields: z.array(z.number()),
      operation: z.enum(["delete"]),
      confirm: z.boolean().optional().describe("Must be true when operation is 'delete' to confirm destructive operation"),
    },
    Annotations.BULK_EDIT,
    withErrorHandling(async (args) => {
      if (args.operation === "delete") requireConfirm(args.confirm);
      const response = await api.bulkEditObjects(
        args.custom_fields,
        "custom_field",
        args.operation
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    })
  );
}
