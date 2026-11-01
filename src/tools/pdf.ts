import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PaperlessAPI } from "../api/PaperlessAPI";
import { Annotations } from "./utils/annotations";
import { withErrorHandling } from "./utils/middlewares";
import {
  inspectDocumentPdf, renderDocumentPdfPage, PdfAccessError
} from "./pdfSupport";

function failure(error: unknown) {
  const known = error instanceof PdfAccessError;
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        status: "error",
        code: known ? error.code : "pdf_access_failed",
        message: known
          ? error.message
          : "Could not access the PDF. Verify the document is a readable PDF and Paperless is available.",
      }),
    }],
    isError: true,
  };
}

/** Access every page of a PDF without sending the entire file to the MCP client. */
export function registerPdfTools(server: McpServer, api: PaperlessAPI): void {
  server.tool(
    "get_document_pdf_info",
    "Inspect a complete PDF: return its actual page count and file size as small JSON. For scanned/multipage documents, call get_document_pdf_page for EACH relevant page; do not assume the thumbnail shows all pages.",
    {
      id: z.number().int().positive().describe("Paperless document ID"),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      try {
        const info = await inspectDocumentPdf(api, args.id);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              documentId: args.id,
              ...info,
              status: "ok",
              pageAccess: "Call get_document_pdf_page with page numbers 1 through pageCount.",
              note: "All pages are available individually as images. Full PDFs are never sent automatically.",
            }),
          }],
        };
      } catch (error) {
        return failure(error);
      }
    })
  );

  server.tool(
    "get_document_pdf_page",
    "Read one COMPLETE PDF page, including layout, handwriting, scanned elements, signatures, stamps and tables. Returns a native MCP JPEG image and up to 14k chars of selectable text. Call repeatedly for all pages when the entire document must be checked. Never sends the full PDF binary.",
    {
      id: z.number().int().positive().describe("Paperless document ID"),
      page: z.number().int().min(1).max(5000).describe("One-based PDF page number to inspect"),
      max_dimension: z.number().int().min(800).max(1600).optional()
        .describe("Maximum rendered image dimension (default 1400 pixels)."),
    },
    Annotations.READ,
    withErrorHandling(async (args) => {
      try {
        const result = await renderDocumentPdfPage(
          api, args.id, args.page, args.max_dimension ?? 1400
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                documentId: args.id,
                page: result.page,
                pageCount: result.pageCount,
                sizeBytes: result.sizeBytes,
                imagePixelsMax: result.pixelLimit,
                selectableText: result.text,
                textTruncated: result.textTruncated,
                note: "This is page " + result.page + " of " + result.pageCount +
                  ". Other pages have not been transmitted. Request them separately when needed.",
              }),
            },
            {
              type: "image" as const,
              data: result.image.toString("base64"),
              mimeType: "image/jpeg",
            },
          ],
        };
      } catch (error) {
        return failure(error);
      }
    })
  );
}
