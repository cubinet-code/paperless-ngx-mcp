import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { paginationFields } from "./utils/schemas";

const mailAccountFields = {
  name: z.string().min(1).max(256),
  imap_server: z.string().max(256),
  imap_port: z.number().int().min(1).max(65535).describe("Usually 993 (SSL) or 143 (STARTTLS / none)"),
  imap_security: z.number().int().min(1).max(3).optional().describe("1=no encryption, 2=SSL, 3=STARTTLS"),
  username: z.string().max(256),
  password: z
    .string()
    .describe("IMAP password or OAuth token. Write-only: Paperless always returns it masked as \"**********\", and sending that mask back leaves the stored password unchanged."),
  character_set: z.string().max(256).optional().describe("e.g. UTF-8 (default) or US-ASCII"),
  is_token: z.boolean().optional().describe("true when `password` is an OAuth/app token"),
  account_type: z.number().int().min(1).max(3).optional().describe("1=IMAP, 2=Gmail OAuth, 3=Outlook OAuth"),
  owner: z.number().nullable().optional(),
};

const optionalText = () => z.string().max(256).nullable().optional();

const mailRuleFields = {
  name: z.string().min(1).max(256),
  account: z.number().describe("Mail account ID"),
  enabled: z.boolean().optional(),
  folder: z.string().max(256).optional().describe("IMAP folder (default INBOX); subfolders use the server's delimiter, e.g. INBOX.Invoices"),
  filter_from: optionalText(),
  filter_to: optionalText(),
  filter_subject: optionalText(),
  filter_body: optionalText(),
  filter_attachment_filename_include: optionalText().describe("Only attachments whose whole filename matches, e.g. *.pdf"),
  filter_attachment_filename_exclude: optionalText().describe("Skip attachments whose whole filename matches"),
  maximum_age: z.number().int().min(0).optional().describe("Only mails younger than this many days (default 30)"),
  action: z.number().int().min(1).max(5).optional().describe("What happens to processed mail: 1=delete, 2=move to action_parameter folder, 3=mark as read (default), 4=flag, 5=tag with action_parameter"),
  action_parameter: z.string().nullable().optional(),
  assign_title_from: z.number().int().min(1).max(3).optional().describe("1=mail subject (default), 2=attachment filename, 3=don't assign"),
  assign_tags: z.array(z.number()).optional(),
  assign_correspondent_from: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("1=don't assign (default), 2=sender mail address, 3=sender name (falls back to address), 4=the correspondent in assign_correspondent. ⚠️ 2 and 3 CREATE a new correspondent for every distinct sender string — the usual cause of duplicate correspondents. Prefer 4, or 1 plus matching rules on existing correspondents."),
  assign_correspondent: z.number().nullable().optional(),
  assign_document_type: z.number().nullable().optional(),
  assign_owner_from_rule: z.boolean().optional(),
  order: z.number().int().optional().describe("Rules run in ascending order"),
  attachment_type: z.number().int().min(1).max(2).optional().describe("1=attachments only (default), 2=all files including inline"),
  consumption_scope: z.number().int().min(1).max(3).optional().describe("1=attachments only (default), 2=whole mail as .eml, 3=.eml plus attachments as separate documents"),
  pdf_layout: z.number().int().min(0).max(4).optional().describe("Mail-to-PDF layout: 0=system default, 1=text then HTML, 2=HTML then text, 3=HTML only, 4=text only"),
  stop_processing: z.boolean().optional().describe("Skip later rules once this rule queued a document"),
  owner: z.number().nullable().optional(),
};

export function registerMailTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "list_mail_accounts",
    "List the IMAP accounts Paperless fetches mail from. Passwords are always masked.",
    paginationFields,
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(`/mail_accounts/${queryString ? `?${queryString}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_mail_account",
    "Get one mail account by ID (password masked).",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/mail_accounts/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_mail_account",
    "Create an IMAP account for Paperless to fetch mail from. Nothing is fetched until a mail rule uses the account (create_mail_rule). Check the connection first with test_mail_account.",
    mailAccountFields,
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/mail_accounts/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "update_mail_account",
    "Update fields on ONE mail account (PATCH — only fields you supply are changed). Omit password to keep the stored one.",
    { id: z.number(), ...z.object(mailAccountFields).partial().shape },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.request(`/mail_accounts/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_mail_account",
    "⚠️ DESTRUCTIVE: Permanently delete a mail account and stop fetching from it. Mail rules using it are deleted too. Already-imported documents are not affected.",
    {
      id: z.number(),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/mail_accounts/${args.id}/`, { method: "DELETE" });
      return deletedResponse();
    })
  );

  server.tool(
    "test_mail_account",
    "Test IMAP connection settings without saving them. Pass the full account fields. To test a SAVED account, pass its `id` together with the masked password \"**********\" from get_mail_account — Paperless then uses the stored password (without `id` it would try the literal asterisks and report a login failure). Note: Paperless 3.2 answers an unreachable server or refused connection with a bare HTTP 500 rather than a message — treat a 500 as 'could not connect'.",
    {
      id: z.number().optional().describe("ID of a saved account whose stored password should be used"),
      ...mailAccountFields,
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request("/mail_accounts/test/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "process_mail_account",
    "Fetch mail for one account now and run its rules, instead of waiting for the schedule. Runs in the background; see list_tasks with task_type mail_fetch.",
    { id: z.number() },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request(`/mail_accounts/${args.id}/process/`, {
        method: "POST",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "list_mail_rules",
    "List mail rules: which mails Paperless imports from which account, and how it assigns title, tags, correspondent and document type.",
    paginationFields,
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(`/mail_rules/${queryString ? `?${queryString}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_mail_rule",
    "Get one mail rule by ID.",
    { id: z.number() },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/mail_rules/${args.id}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_mail_rule",
    "Create a mail rule on a mail account: which folder and mails to consider, which attachments to import, and what to assign to the resulting documents.",
    mailRuleFields,
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/mail_rules/", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "update_mail_rule",
    "Update fields on ONE mail rule (PATCH — only fields you supply are changed). E.g. switch assign_correspondent_from to 4 to stop creating a correspondent per sender.",
    { id: z.number(), ...z.object(mailRuleFields).partial().shape },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...data } = args;
      const response = await api.request(`/mail_rules/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_mail_rule",
    "⚠️ DESTRUCTIVE: Permanently delete a mail rule. Already-imported documents are not affected.",
    {
      id: z.number(),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/mail_rules/${args.id}/`, { method: "DELETE" });
      return deletedResponse();
    })
  );
}
