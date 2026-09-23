import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { CUSTOM_FIELD_QUERY_DESCRIPTION, CUSTOM_FIELD_VALUE_DESCRIPTION } from "./utils/descriptions";
import { paginationFields } from "./utils/schemas";

const idList = () => z.array(z.number()).optional();

export const workflowActionType = z
  .number()
  .int()
  .min(1)
  .max(8)
  .describe(
    "Action type: 1=assignment, 2=removal, 3=email, 4=webhook, 5=password removal (needs passwords), 6=move to trash, 7=remote OCR (its workflow must have a type-1 consumption-started trigger), 8=apply AI suggestions (needs ai_suggestion_fields; its workflow must have a trigger other than type 1)"
  );

export const workflowTriggerType = z
  .number()
  .int()
  .min(1)
  .max(4)
  .describe(
    "Trigger type: 1=consumption started, 2=document added, 3=document updated, 4=scheduled"
  );

export const workflowActionFields = {
  assign_title: z.string().max(256).nullable().optional().describe("Type 1: Jinja2 title template"),
  assign_tags: idList(),
  assign_correspondent: z.number().nullable().optional(),
  assign_document_type: z.number().nullable().optional(),
  assign_storage_path: z.number().nullable().optional(),
  assign_owner: z.number().nullable().optional(),
  assign_view_users: idList(),
  assign_view_groups: idList(),
  assign_change_users: idList(),
  assign_change_groups: idList(),
  assign_custom_fields: idList().describe("Type 1: custom field IDs to add"),
  assign_custom_fields_values: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.number()), z.null()])
    )
    .optional()
    .describe(
      `Type 1: values for assign_custom_fields keyed by custom field ID, e.g. {"7": "2026-01-01"}. ${CUSTOM_FIELD_VALUE_DESCRIPTION}`
    ),
  remove_all_tags: z.boolean().optional(),
  remove_tags: idList(),
  remove_all_correspondents: z.boolean().optional(),
  remove_correspondents: idList(),
  remove_all_document_types: z.boolean().optional(),
  remove_document_types: idList(),
  remove_all_storage_paths: z.boolean().optional(),
  remove_storage_paths: idList(),
  remove_all_custom_fields: z.boolean().optional(),
  remove_custom_fields: idList(),
  remove_all_owners: z.boolean().optional(),
  remove_owners: idList(),
  remove_all_permissions: z.boolean().optional(),
  remove_view_users: idList(),
  remove_view_groups: idList(),
  remove_change_users: idList(),
  remove_change_groups: idList(),
  email: z
    .object({
      subject: z.string(),
      body: z.string(),
      to: z.string().describe("Comma-separated email addresses"),
      include_document: z.boolean().optional(),
    })
    .nullable()
    .optional()
    .describe("Type 3: email configuration"),
  webhook: z
    .object({
      url: z.string(),
      use_params: z.boolean().optional(),
      params: z.record(z.string(), z.string()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
    })
    .nullable()
    .optional()
    .describe("Type 4: webhook configuration"),
  passwords: z
    .array(z.string())
    .min(1)
    .optional()
    .describe("Type 5 (required): PDF passwords to try, in order. The unlocked file is stored as a new version of the document."),
  ai_suggestion_fields: z
    .array(z.enum(["title", "tags", "correspondent", "document_type", "storage_path", "created"]))
    .min(1)
    .optional()
    .describe("Type 8 (required): which AI suggestions to apply. Needs AI enabled in Paperless."),
  ai_create_missing: z
    .boolean()
    .optional()
    .describe("Type 8: create suggested tags/correspondents/document types/storage paths that don't exist yet"),
  ai_overwrite_existing: z
    .boolean()
    .optional()
    .describe("Type 8: apply suggestions even when the document already has a value"),
};

export const workflowTriggerFields = {
  sources: z
    .array(z.number().int().min(1).max(4))
    .optional()
    .describe("Consumption sources: 1=consume folder, 2=API upload, 3=mail fetch, 4=web UI (default [1,2,3])"),
  filter_path: z.string().max(256).nullable().optional().describe("Path pattern, * wildcards allowed"),
  filter_filename: z
    .string()
    .max(256)
    .nullable()
    .optional()
    .describe("Filename pattern (whole name must match), * wildcards allowed"),
  filter_mailrule: z.number().nullable().optional().describe("Only documents fetched by this mail rule ID"),
  matching_algorithm: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("Content match for `match`: 0=none, 1=any word, 2=all words, 3=exact, 4=regular expression, 5=fuzzy word"),
  match: z.string().max(256).optional(),
  is_insensitive: z.boolean().optional(),
  filter_has_tags: idList().describe("Document has ANY of these tags"),
  filter_has_all_tags: idList().describe("Document has ALL of these tags"),
  filter_has_not_tags: idList().describe("Document has NONE of these tags"),
  filter_has_any_correspondents: idList().describe("Correspondent is one of these"),
  filter_has_not_correspondents: idList().describe("Correspondent is none of these"),
  filter_has_any_document_types: idList().describe("Document type is one of these"),
  filter_has_not_document_types: idList().describe("Document type is none of these"),
  filter_has_any_storage_paths: idList().describe("Storage path is one of these"),
  filter_has_not_storage_paths: idList().describe("Storage path is none of these"),
  filter_custom_field_query: z.string().nullable().optional().describe(CUSTOM_FIELD_QUERY_DESCRIPTION),
  schedule_offset_days: z.number().int().optional().describe("Type 4: days to offset from schedule_date_field"),
  schedule_is_recurring: z.boolean().optional(),
  schedule_recurring_interval_days: z.number().int().min(1).optional(),
  schedule_date_field: z
    .enum(["added", "created", "modified", "custom_field"])
    .optional()
    .describe("Type 4: date the schedule is based on"),
  schedule_date_custom_field: z.number().nullable().optional().describe("Type 4 with schedule_date_field=custom_field: the date custom field ID"),
};

export function registerWorkflowTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_workflow_actions",
    "List all workflow actions with optional pagination.",
    paginationFields,
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/workflow_actions/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_workflow_action",
    "Get a specific workflow action by ID.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/workflow_actions/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_workflow_action",
    "Create ONE workflow action. On its own an action does nothing — it runs only as part of a workflow. To build an automation, use create_workflow with nested triggers and actions; use this tool to prepare or inspect a single piece.",
    {
      type: workflowActionType,
      ...workflowActionFields,
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/workflow_actions/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "update_workflow_action",
    "Update fields on ONE workflow action (PATCH — only fields you supply are changed). Use get_workflow_action first to see its current shape. To change the actions of a whole workflow, see update_workflow.",
    {
      id: z.number(),
      type: workflowActionType.optional(),
      ...workflowActionFields,
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.request(`/workflow_actions/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_workflow_action",
    "⚠️ DESTRUCTIVE: Permanently delete a workflow action.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/workflow_actions/${args.id}/`, {
        method: "DELETE",
      });
      return deletedResponse();
    })
  );

  server.tool(
    "list_workflow_triggers",
    "List all workflow triggers with optional pagination.",
    paginationFields,
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/workflow_triggers/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_workflow_trigger",
    "Get a specific workflow trigger by ID.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/workflow_triggers/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_workflow_trigger",
    "Create ONE workflow trigger. On its own a trigger does nothing — it fires only as part of a workflow. To build an automation, use create_workflow with nested triggers and actions.",
    {
      type: workflowTriggerType,
      ...workflowTriggerFields,
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/workflow_triggers/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "update_workflow_trigger",
    "Update fields on ONE workflow trigger (PATCH — only fields you supply are changed). Use get_workflow_trigger first to see its current shape.",
    {
      id: z.number(),
      type: workflowTriggerType.optional(),
      ...workflowTriggerFields,
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.request(`/workflow_triggers/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_workflow_trigger",
    "⚠️ DESTRUCTIVE: Permanently delete a workflow trigger.",
    {
      id: z.number(),
      confirm: z
        .boolean()
        .describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/workflow_triggers/${args.id}/`, {
        method: "DELETE",
      });
      return deletedResponse();
    })
  );
}
