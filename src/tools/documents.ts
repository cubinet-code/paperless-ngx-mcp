import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { convertDocsWithNames } from "../api/documentEnhancer";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { BulkEditParameters, Document } from "../api/types";
import { Annotations } from "./utils/annotations";
import { CUSTOM_FIELD_VALUE_DESCRIPTION } from "./utils/descriptions";
import { arrayNotEmpty } from "./utils/empty";
import { withErrorHandling } from "./utils/middlewares";
import { validateCustomFields } from "./utils/monetary";
import {
  parseFilenameFromContentDisposition,
  requireConfirm,
} from "./utils/responses";
import { buildQueryString } from "./utils/queryString";
import { paginationFields } from "./utils/schemas";

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

function isLikelyBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_REGEX.test(value);
}

function getContentDispositionHeader(headers: unknown): string | null {
  if (!headers || typeof headers !== "object") return null;
  const h = headers as { get?: (name: string) => string | null } & Record<
    string,
    string | undefined
  >;
  if (typeof h.get === "function") return h.get("content-disposition");
  return h["content-disposition"] ?? null;
}

export function registerDocumentTools(server: McpServer, api: PaperlessAPI) {
  server.tool(
    "edit_documents_bulk",
    "Apply ONE of a fixed set of operations to MANY documents at once. Methods: set_correspondent, set_document_type, set_storage_path, add_tag, remove_tag, modify_tags, modify_custom_fields, set_permissions, delete, reprocess, merge, split, rotate, delete_pages, edit_pdf. For per-document field edits including title, content, created (date), archive_serial_number, or owner, use update_document instead — those fields are not editable here. Note: 'remove_tag' only removes the tag from the specified documents (tag stays in the system); 'delete_tag' permanently deletes the tag from the entire system. ⚠️ WARNING: method 'delete' permanently deletes documents and requires confirm=true.",
    {
      documents: z.array(z.number()),
      method: z.enum([
        "set_correspondent",
        "set_document_type",
        "set_storage_path",
        "add_tag",
        "remove_tag",
        "modify_tags",
        "modify_custom_fields",
        "delete",
        "reprocess",
        "set_permissions",
        "merge",
        "split",
        "rotate",
        "delete_pages",
        "edit_pdf",
      ]),
      correspondent: z.number().optional(),
      document_type: z.number().optional(),
      storage_path: z.number().optional(),
      tag: z.number().optional(),
      add_tags: z.array(z.number()).optional().transform(arrayNotEmpty),
      remove_tags: z.array(z.number()).optional().transform(arrayNotEmpty),
      add_custom_fields: z
        .array(
          z.object({
            field: z.number(),
            value: z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.array(z.number()),
                z.null(),
              ])
              .describe(CUSTOM_FIELD_VALUE_DESCRIPTION),
          })
        )
        .optional()
        .transform(arrayNotEmpty),
      remove_custom_fields: z
        .array(z.number())
        .optional()
        .transform(arrayNotEmpty),
      set_permissions: z
        .object({
          view: z.object({
            users: z.array(z.number()),
            groups: z.array(z.number()),
          }),
          change: z.object({
            users: z.array(z.number()),
            groups: z.array(z.number()),
          }),
        })
        .optional()
        .describe(
          "Permission grants for set_permissions method. view/change each take user and group ID lists."
        ),
      owner: z
        .number()
        .nullable()
        .optional()
        .describe("Owner user ID for set_permissions method (null clears the owner)."),
      merge: z
        .boolean()
        .optional()
        .describe(
          "When true with set_permissions, merges with existing permissions instead of replacing."
        ),
      operations: z
        .array(
          z.object({
            page: z.number(),
            rotate: z.number().optional(),
            doc: z.number().optional(),
          })
        )
        .optional()
        .describe(
          "Per-page operations for edit_pdf method. Each entry: {page, rotate?, doc?}."
        ),
      update_document: z
        .boolean()
        .optional()
        .describe("edit_pdf: replace the document in place (default false)."),
      include_metadata: z
        .boolean()
        .optional()
        .describe("edit_pdf: copy metadata to the new document (default true)."),
      metadata_document_id: z.number().optional(),
      delete_originals: z.boolean().optional(),
      pages: z.string().optional(),
      degrees: z.number().optional(),
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Must be true when method is 'delete' to confirm destructive operation"
        ),
    },
    Annotations.BULK_EDIT,
    withErrorHandling(async (args) => {
      if (args.method === "delete") requireConfirm(args.confirm);
      const { documents, method, add_custom_fields, confirm, ...rest } = args;

      validateCustomFields(add_custom_fields);

      const apiParameters: BulkEditParameters = { ...rest };
      if (add_custom_fields && add_custom_fields.length > 0) {
        // Upstream BulkEditSerializer expects {field_id: value} dict on the wire.
        apiParameters.add_custom_fields = Object.fromEntries(
          add_custom_fields.map((cf) => [String(cf.field), cf.value])
        );
      }
      if (method === "modify_custom_fields") {
        // Upstream requires BOTH keys present even when only one side is used.
        apiParameters.add_custom_fields ??= [];
        apiParameters.remove_custom_fields ??= [];
      }

      const response = await api.bulkEditDocuments(
        documents,
        method,
        apiParameters
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ result: response.result }),
          },
        ],
      };
    })
  );

  server.tool(
    "post_document",
    "Upload a new document file (PDF, image, etc.) to Paperless-NGX with optional metadata. Upload is asynchronous: typically returns a task UUID (use list_tasks to track consumer progress) — the actual document ID is assigned only after the consumer has processed the file. Optional metadata: title, created (date), correspondent, document_type, storage_path, tags, archive_serial_number, custom_fields.",
    {
      file: z.string().describe("Base64-encoded file content, or an absolute file path (e.g. /tmp/invoice.pdf) which the server will read directly"),
      filename: z.string().describe("Original filename including extension (e.g. 'invoice.pdf')"),
      title: z.string().optional(),
      created: z.string().optional(),
      correspondent: z.number().optional(),
      document_type: z.number().optional(),
      storage_path: z.number().optional(),
      tags: z.array(z.number()).optional(),
      archive_serial_number: z.number().optional(),
      custom_fields: z.array(z.number()).optional(),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const { file, filename, ...metadata } = args;
      let document: Buffer;
      if (path.isAbsolute(file)) {
        document = await fs.readFile(file);
      } else {
        if (!isLikelyBase64(file)) {
          throw new Error(
            "Invalid input: provide a valid base64 string or an absolute file path."
          );
        }
        document = Buffer.from(file, "base64");
      }

      const cleanedMetadata = Object.fromEntries(
        Object.entries(metadata).filter(([, v]) => v !== undefined)
      );
      const response = await api.postDocument(document, filename, cleanedMetadata);
      const result =
        typeof response === "string" && /^\d+$/.test(response)
          ? { id: Number(response) }
          : { status: response };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    })
  );

  server.tool(
    "list_documents",
    "List and filter documents by fields such as title, correspondent, document type, tag, storage path, creation date, and more. IMPORTANT: For queries like 'the last 3 contributions' or when searching by tag, correspondent, document type, or storage path, you should FIRST use the relevant tool (e.g., 'list_tags', 'list_correspondents', 'list_document_types', 'list_storage_paths') to find the correct ID, and then use that ID as a filter here. Only use the 'search' argument for free-text search when no specific field applies. Using the correct ID filter will yield much more accurate results. Note: Document content is excluded from results by default. Use 'get_document_content' to retrieve content when needed.",
    {
      ...paginationFields,
      search: z.string().optional(),
      correspondent: z.number().optional(),
      document_type: z.number().optional(),
      tag: z.number().optional(),
      storage_path: z.number().optional(),
      created__date__gte: z.string().optional(),
      created__date__lte: z.string().optional(),
      ordering: z.string().optional(),
      more_like_id: z.number().optional().describe("Find documents similar to the document with this ID"),
      custom_field_query: z.string().optional().describe("Filter by custom field values using query syntax, e.g. 'custom_field_123=value'"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const {
        correspondent,
        document_type,
        tag,
        storage_path,
        ...rest
      } = args;
      const queryString = buildQueryString({
        ...rest,
        correspondent__id: correspondent,
        document_type__id: document_type,
        tags__id: tag,
        storage_path__id: storage_path,
      });
      const docsResponse = await api.getDocuments(
        queryString ? `?${queryString}` : ""
      );
      return convertDocsWithNames(docsResponse, api);
    })
  );

  server.tool(
    "get_document",
    "Get a specific document by ID with full details including correspondent, document type, tags, and custom fields. Note: Document content is excluded from results by default. Use 'get_document_content' to retrieve content when needed.",
    {
      id: z.number(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const doc = await api.getDocument(args.id);
      return convertDocsWithNames(doc, api);
    })
  );

  server.tool(
    "get_document_content",
    "Get the text content of a specific document by ID. Use this when you need to read or analyze the actual document text.",
    {
      id: z.number(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const doc = await api.getDocument(args.id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: doc.id,
              title: doc.title,
              content: doc.content,
            }),
          },
        ],
      };
    })
  );

  server.tool(
    "search_documents",
    "Full text search for documents. This tool is for searching document content, title, and metadata using a full text query. For general document listing or filtering by fields, use 'list_documents' instead. Note: Document content is excluded from results by default. Use 'get_document_content' to retrieve content when needed.",
    {
      query: z.string(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const docsResponse = await api.searchDocuments(args.query);
      return convertDocsWithNames(docsResponse, api);
    })
  );

  server.tool(
    "download_document",
    "Download a document file by ID. Returns the document as a base64-encoded resource.",
    {
      id: z.number(),
      original: z.boolean().optional(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.downloadDocument(args.id, args.original);
      const filename = parseFilenameFromContentDisposition(
        getContentDispositionHeader(response.headers),
        `document-${args.id}`
      );
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: filename,
              blob: Buffer.from(response.data).toString("base64"),
              mimeType: "application/pdf",
            },
          },
        ],
      };
    })
  );

  server.tool(
    "get_document_thumbnail",
    "Get a document thumbnail (image preview) by ID. Returns the thumbnail as a base64-encoded WebP image resource.",
    {
      id: z.number(),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.getThumbnail(args.id);
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: `document-${args.id}-thumb.webp`,
              blob: Buffer.from(response.data).toString("base64"),
              mimeType: "image/webp",
            },
          },
        ],
      };
    })
  );

  server.tool(
    "update_document",
    "Update fields on ONE document (PATCH — only fields you supply are changed). Editable fields: title, correspondent, document_type, storage_path, tags (replaces the array), content (raw searchable text), created (document date, YYYY-MM-DD), archive_serial_number, owner, custom_fields. For applying the same change to MANY documents, see edit_documents_bulk. To add a comment/annotation rather than change a field, see create_document_note.",
    {
      id: z.number().describe("The ID of the document to update"),
      title: z
        .string()
        .max(128)
        .optional()
        .describe("The new title for the document (max 128 characters)"),
      correspondent: z
        .number()
        .nullable()
        .optional()
        .describe("The ID of the correspondent to assign"),
      document_type: z
        .number()
        .nullable()
        .optional()
        .describe("The ID of the document type to assign"),
      storage_path: z
        .number()
        .nullable()
        .optional()
        .describe("The ID of the storage path to assign"),
      tags: z
        .array(z.number())
        .optional()
        .describe("Array of tag IDs to assign to the document"),
      content: z
        .string()
        .optional()
        .describe("The raw text content of the document (used for searching)"),
      created: z
        .string()
        .optional()
        .describe("The creation date in YYYY-MM-DD format"),
      archive_serial_number: z
        .number()
        .optional()
        .describe("The archive serial number (0-4294967295)"),
      owner: z
        .number()
        .nullable()
        .optional()
        .describe("The ID of the user who owns the document"),
      custom_fields: z
        .array(
          z.object({
            field: z.number().describe("The custom field ID"),
            value: z
              .union([
                z.string(),
                z.number(),
                z.boolean(),
                z.array(z.number()),
                z.null(),
              ])
              .describe(CUSTOM_FIELD_VALUE_DESCRIPTION),
          })
        )
        .optional()
        .describe("Array of custom field values to assign"),
    },
    Annotations.UPDATE,
    withErrorHandling(async (args) => {
      const { id, ...updateData } = args;

      validateCustomFields(updateData.custom_fields);

      const response = await api.updateDocument(id, updateData as Partial<Document>);

      return convertDocsWithNames(response, api);
    })
  );

  server.tool(
    "email_document",
    "Send a document via email to one or more recipients.",
    {
      id: z.number().describe("The document ID to send"),
      addresses: z.string().describe("Comma-separated email addresses"),
      subject: z.string().describe("Email subject line"),
      message: z.string().describe("Email body message"),
      use_archive_version: z
        .boolean()
        .optional()
        .describe("Send the archive version (default: true)"),
    },
    Annotations.CREATE,
    withErrorHandling(async (args) => {
      const { id, ...emailData } = args;
      const response = await api.request(`/documents/${id}/email/`, {
        method: "POST",
        body: JSON.stringify(emailData),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_document_history",
    "Get the change history / audit log for a document, showing who changed what and when.",
    {
      id: z.number().describe("The document ID"),
      ...paginationFields,
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const { id, ...pagination } = args;
      const queryString = buildQueryString(pagination);
      const response = await api.request(
        `/documents/${id}/history/${queryString ? `?${queryString}` : ""}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    })
  );

  server.tool(
    "get_document_preview",
    "Get a full-page preview image of a document. Returns the preview as a base64-encoded image resource.",
    {
      id: z.number().describe("The document ID"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      const response = await api.requestRaw(`/documents/${args.id}/preview/`, {
        responseType: "arraybuffer",
      });
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: `document-${args.id}-preview.webp`,
              blob: Buffer.from(response.data).toString("base64"),
              mimeType: "image/webp",
            },
          },
        ],
      };
    })
  );
}
