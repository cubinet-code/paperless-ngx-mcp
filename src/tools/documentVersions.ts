import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { FILE_INPUT_DESCRIPTION, readFileInput } from "./utils/fileInput";
import { withErrorHandling } from "./utils/middlewares";
import { deletedResponse, requireConfirm } from "./utils/responses";
import { isTerminalTaskStatus, pollConsumeTask } from "./utils/tasks";

export function registerDocumentVersionTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "upload_document_version",
    "Add a new file version to an EXISTING document instead of creating a new document — e.g. a corrected scan, a signed copy, or an unlocked PDF. The new file becomes the current version: content, search and downloads follow it, and earlier versions stay listed in the document's `versions` (see get_document). Processing is asynchronous like post_document; set poll=true to wait. To strip a PDF password you don't need to re-upload: use edit_documents_bulk method remove_password with update_document=true.",
    {
      id: z.number().describe("The document to add the version to"),
      file: z.string().describe(FILE_INPUT_DESCRIPTION),
      filename: z.string().describe("Filename including extension, e.g. 'contract-signed.pdf'"),
      version_label: z.string().optional().describe("Short label shown in the versions list, e.g. 'signed'"),
      poll: z.boolean().optional().describe("Wait for processing to finish (default false)"),
      poll_timeout_seconds: z.number().int().min(1).max(300).optional().describe("Max seconds to wait when poll=true (default 30)"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const document = await readFileInput(args.file);
      const response = await api.uploadDocumentVersion(
        args.id,
        document,
        args.filename,
        args.version_label
      );
      const taskUuid = response.replace(/"/g, "").trim();
      const json = (obj: unknown) => ({
        content: [{ type: "text" as const, text: JSON.stringify(obj) }],
      });
      if (!args.poll) return json({ task_id: taskUuid });

      const timeoutMs = (args.poll_timeout_seconds ?? 30) * 1000;
      const task = await pollConsumeTask(api, taskUuid, timeoutMs);
      if (!task || !isTerminalTaskStatus(task.status)) {
        return json({
          task_id: taskUuid,
          status: task?.status ?? "pending",
          timed_out: true,
          message: `Processing did not finish within ${timeoutMs / 1000}s. Use list_tasks with this task_id to keep tracking.`,
        });
      }
      if (task.status === "success") {
        // Paperless's task result names the new version `document_id`.
        const versionId = (task.result_data as { document_id?: number } | null)?.document_id;
        return json({
          task_id: taskUuid,
          status: task.status,
          document_id: args.id,
          version_id: versionId,
        });
      }
      return json({ task_id: taskUuid, status: task.status, result: task.result_data });
    })
  );

  server.tool(
    "update_document_version",
    "Rename a version of a document (change its version_label). Version IDs are listed in get_document's `versions`.",
    {
      id: z.number().describe("The document ID"),
      version_id: z.number().describe("The version ID from the document's `versions`"),
      version_label: z.string().describe("New label"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const response = await api.request(
        `/documents/${args.id}/versions/${args.version_id}/`,
        { method: "PATCH", body: JSON.stringify({ version_label: args.version_label }) }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "delete_document_version",
    "⚠️ DESTRUCTIVE: Permanently delete one non-root version of a document. The root (original) version can't be deleted — delete the document instead.",
    {
      id: z.number().describe("The document ID"),
      version_id: z.number().describe("The version ID from the document's `versions` (is_root must be false)"),
      confirm: z.boolean().describe("Must be true to confirm this destructive operation"),
    },
    Annotations.DELETE,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      await api.request(`/documents/${args.id}/versions/${args.version_id}/`, {
        method: "DELETE",
      });
      return deletedResponse();
    })
  );

  server.tool(
    "merge_documents_as_versions",
    "⚠️ Fold other documents into one document as its versions: each document in merge_documents stops existing as a separate document and becomes a version of root_document_id. Use it when the same paper arrived twice (e.g. a scan and a later emailed copy). Runs asynchronously.",
    {
      root_document_id: z.number().describe("The document that keeps existing and receives the versions"),
      merge_documents: z.array(z.number()).min(1).describe("Documents to turn into versions of the root"),
      version_label: z.string().max(64).optional().describe("Label for the new versions"),
      confirm: z.boolean().describe("Must be true — merged documents no longer exist as separate documents"),
    },
    Annotations.BULK_EDIT,
    withErrorHandling(async (args) => {
      requireConfirm(args.confirm);
      // Upstream wants the root inside `documents` alongside the ones to fold in.
      const documents = [
        ...new Set([args.root_document_id, ...args.merge_documents]),
      ];
      const response = await api.request("/documents/merge_as_versions/", {
        method: "POST",
        body: JSON.stringify({
          root_document_id: args.root_document_id,
          documents,
          version_label: args.version_label,
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );
}
