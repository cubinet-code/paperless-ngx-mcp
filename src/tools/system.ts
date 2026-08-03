import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { arrayNotEmpty } from "./utils/empty";
import { withErrorHandling } from "./utils/middlewares";
import { buildQueryString } from "./utils/queryString";
import { PaginatedResponse, toItemArray } from "./utils/paginate";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { paginationFields } from "./utils/schemas";

interface Task {
  id: number;
  task_id: string;
  // Paperless 2.x sends `task_name`; 3.x renamed it to `task_type`.
  task_name?: string;
  task_type?: string;
  status: string;
  date_created?: string;
  [key: string]: unknown;
}

/**
 * Paperless 2.x expects uppercase task statuses (`SUCCESS`) and 3.x expects
 * lowercase (`success`); each rejects the other with a 400. Try one casing,
 * fall back to the other, and remember which the server accepted.
 */
type StatusCasing = "lower" | "upper";

const applyCasing = (status: string, casing: StatusCasing) =>
  casing === "upper" ? status.toUpperCase() : status.toLowerCase();

export function registerSystemTools(server: McpServer, api: PaperlessAPI) {
  // Cached per registered server, so it is scoped to one Paperless instance.
  let acceptedStatusCasing: StatusCasing | undefined;

  server.tool(
    "get_statistics",
    "Get system statistics including document counts, inbox status, file type breakdown, and storage information.",
    {},
    Annotations.READ,
    withErrorHandling(async () => {
      const response = await api.request("/statistics/");
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_document_suggestions",
    "Get AI-powered suggestions for a document's correspondent, tags, and document type based on its content.",
    { id: z.number().describe("The document ID to get suggestions for") },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/documents/${args.id}/suggestions/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_document_metadata",
    "Get file metadata for a document including checksums, file sizes, and archival information.",
    { id: z.number().describe("The document ID") },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.request(`/documents/${args.id}/metadata/`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "list_document_notes",
    "List all notes for a specific document.",
    {
      id: z.number().describe("The document ID"),
      ...paginationFields,
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { id, ...pagination } = args;
      const queryString = buildQueryString(pagination);
      const response = await api.request(`/documents/${id}/notes/${queryString ? `?${queryString}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "create_document_note",
    "Append a user-facing note (comment/annotation) to a document. Notes are separate from the document's searchable 'content' field — to change body text or other metadata fields, use update_document instead.",
    {
      id: z.number().describe("The document ID"),
      note: z.string().describe("The note text to add"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const response = await api.request(`/documents/${args.id}/notes/`, {
        method: "POST",
        body: JSON.stringify({ note: args.note }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_document_note",
    "⚠️ DESTRUCTIVE: Delete a note from a document.",
    {
      id: z.number().describe("The document ID"),
      note_id: z.number().describe("The note ID to delete"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/documents/${args.id}/notes/${args.note_id}/`, {
        method: "DELETE",
      });
      return deletedResponse();
    })
  );

  server.tool(
    "delete_document",
    "Move a document to trash (soft-delete). The document remains recoverable until the trash is emptied or the retention window expires (~30 days). Use empty_trash for permanent deletion.",
    {
      id: z.number().describe("The ID of the document to delete"),
      confirm: z
        .boolean()
        .describe(
          "Must be set to true to confirm this destructive operation"
        ),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.deleteDocument(args.id);
      return deletedResponse();
    })
  );

  server.tool(
    "list_trash",
    "List documents in the trash (soft-deleted documents).",
    paginationFields,
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/trash/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "restore_from_trash",
    "Restore documents from the trash back to the system.",
    {
      documents: z.array(z.number()).min(1).describe("Array of document IDs to restore"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/trash/", {
        method: "POST",
        body: JSON.stringify({
          documents: args.documents,
          action: "restore",
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "empty_trash",
    "⚠️ DESTRUCTIVE: Permanently delete documents from the trash, or empty the entire trash. This action is irreversible.",
    {
      documents: z.array(z.number()).optional().transform(arrayNotEmpty).describe("Array of document IDs to permanently delete. If omitted, empties the entire trash."),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      const response = await api.request("/trash/", {
        method: "POST",
        body: JSON.stringify({
          action: "empty",
          ...(args.documents && { documents: args.documents }),
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "search_autocomplete",
    "Get search term autocomplete suggestions based on the document index.",
    {
      term: z.string().describe("The partial search term to autocomplete"),
      limit: z.number().optional().describe("Maximum number of suggestions (default 10)"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const queryString = buildQueryString(args);
      const response = await api.request(
        `/search/autocomplete/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_next_asn",
    "Get the next available Archive Serial Number (ASN) for document filing.",
    {},
    Annotations.READ,
    withErrorHandling(async () => {
      const response = await api.request("/documents/next_asn/");
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "list_tasks",
    "List background tasks with their status, progress, and results. Useful for monitoring document consumption and other async operations. Use the filters to narrow the list; `limit` truncates what is returned.",
    {
      status: z.enum(["pending", "started", "success", "failure", "revoked"]).optional().describe("Filter by task state. Case is adjusted automatically for the server's Paperless version."),
      task_type: z.enum(["consume_file", "train_classifier", "sanity_check", "index_optimize", "mail_fetch", "llm_index", "empty_trash", "check_workflows", "bulk_update", "reprocess_document", "build_share_link", "bulk_delete"]).optional().describe("Filter by task type (Paperless 3.x). Ignored by 2.x servers — use task_name there."),
      trigger_source: z.enum(["scheduled", "web_ui", "api_upload", "folder_consume", "email_consume", "system", "manual"]).optional().describe("Filter by what triggered the task (Paperless 3.x). Ignored by 2.x servers — use type there."),
      task_name: z.enum(["consume_file", "train_classifier", "check_sanity", "index_optimize"]).optional().describe("Filter by task name (Paperless 2.x). Ignored by 3.x servers — use task_type there."),
      type: z.enum(["auto_task", "scheduled_task", "manual_task"]).optional().describe("Filter by task origin (Paperless 2.x). Ignored by 3.x servers — use trigger_source there."),
      acknowledged: z.boolean().optional().describe("Filter by acknowledged status (false = unacknowledged tasks only)"),
      ordering: z.string().optional().describe("Field to order by, e.g. '-date_created'"),
      limit: z.number().int().min(1).optional().describe("Max number of tasks to return (default 25). Truncates the fetched results client-side."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { limit, status, ...filterArgs } = args;
      const fetchTasks = (casing: StatusCasing) => {
        const queryString = buildQueryString({
          ...filterArgs,
          ...(status ? { status: applyCasing(status, casing) } : {}),
        });
        return api.request<PaginatedResponse<Task> | Task[]>(
          `/tasks/${queryString ? `?${queryString}` : ""}`
        );
      };

      let response;
      if (!status) {
        response = await fetchTasks("lower");
      } else {
        const first = acceptedStatusCasing ?? "lower";
        try {
          response = await fetchTasks(first);
          acceptedStatusCasing = first;
        } catch {
          const fallback: StatusCasing = first === "lower" ? "upper" : "lower";
          response = await fetchTasks(fallback);
          acceptedStatusCasing = fallback;
        }
      }
      const tasks = toItemArray(response).slice(0, limit ?? 25);
      return {
        content: [{ type: "text", text: JSON.stringify(tasks) }],
      };
    })
  );

  server.tool(
    "acknowledge_tasks",
    "Acknowledge/dismiss completed tasks to clear them from the task list.",
    {
      tasks: z.array(z.number()).min(1).describe("Array of task IDs to acknowledge"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const response = await api.request("/tasks/acknowledge/", {
        method: "POST",
        body: JSON.stringify({ tasks: args.tasks }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "download_documents_bulk",
    "Download multiple documents as a ZIP archive. Returns base64-encoded ZIP file.",
    {
      documents: z.array(z.number()).min(1).max(500).describe("Array of document IDs to download (max 500)"),
      content: z
        .enum(["both", "originals", "archive"])
        .optional()
        .describe("Which file versions to include (default: both)"),
      compression: z
        .enum(["none", "lzma", "bzip2", "deflated"])
        .optional()
        .describe("ZIP compression method (default: none)"),
      follow_formatting: z
        .boolean()
        .optional()
        .describe("Use document storage path formatting for filenames"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { documents, ...options } = args;
      const response = await api.requestRaw("/documents/bulk_download/", {
        method: "POST",
        body: JSON.stringify({ documents, ...options }),
        responseType: "arraybuffer",
      });
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: "bulk-download.zip",
              blob: Buffer.from(response.data as ArrayBuffer).toString("base64"),
              mimeType: "application/zip",
            },
          },
        ],
      };
    })
  );
}
