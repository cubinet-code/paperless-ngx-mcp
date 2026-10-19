import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { registerDocumentTools } from "./documents";
import { registerSystemTools } from "./system";
import { createMockApi, createMockServer, getResourceContent } from "./test-helpers";
import { paperlessResourceUri } from "./utils/responses";

describe("embedded binary resources", () => {
  test("uses an absolute URI and percent-encodes filenames", () => {
    const uri = paperlessResourceUri("documents", 42, "Ärztliche Unterlagen/2026.pdf");
    assert.equal(uri, "paperless://files/documents/42/%C3%84rztliche%20Unterlagen%2F2026.pdf");
    assert.equal(new URL(uri).protocol, "paperless:");
  });

  test("download_document returns a valid URI and unchanged PDF bytes", async () => {
    const bytes = Buffer.from("%PDF-1.7", "utf8");
    const { server, tools } = createMockServer();
    registerDocumentTools(server, createMockApi({
      downloadDocument: async () => ({
        data: bytes,
        headers: { "content-disposition": 'attachment; filename="Bericht 2026.pdf"' },
      }),
    }));

    const result = await tools.get("download_document")!.callback({ id: 42 });
    assert.deepEqual(getResourceContent(result), {
      uri: "paperless://files/documents/42/Bericht%202026.pdf",
      blob: bytes.toString("base64"),
      mimeType: "application/pdf",
    });
  });

  test("get_document_thumbnail returns a valid URI and unchanged image bytes", async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const { server, tools } = createMockServer();
    registerDocumentTools(server, createMockApi({
      getThumbnail: async () => ({ data: bytes }),
    }));

    const result = await tools.get("get_document_thumbnail")!.callback({ id: 42 });
    assert.deepEqual(getResourceContent(result), {
      uri: "paperless://files/documents/42/thumbnail.webp",
      blob: bytes.toString("base64"),
      mimeType: "image/webp",
    });
  });

  test("get_document_preview returns a valid URI and unchanged image bytes", async () => {
    const bytes = Buffer.from([4, 5, 6]);
    const { server, tools } = createMockServer();
    registerDocumentTools(server, createMockApi({
      requestRaw: async () => ({ data: bytes }),
    }));

    const result = await tools.get("get_document_preview")!.callback({ id: 42 });
    assert.deepEqual(getResourceContent(result), {
      uri: "paperless://files/documents/42/preview.webp",
      blob: bytes.toString("base64"),
      mimeType: "image/webp",
    });
  });

  test("download_documents_bulk returns a valid URI and unchanged ZIP bytes", async () => {
    const bytes = Buffer.from([80, 75, 3, 4]);
    const { server, tools } = createMockServer();
    registerSystemTools(server, createMockApi({
      requestRaw: async () => ({ data: bytes }),
    }));

    const result = await tools.get("download_documents_bulk")!.callback({ documents: [42] });
    assert.deepEqual(getResourceContent(result), {
      uri: "paperless://files/documents/bulk-download.zip",
      blob: bytes.toString("base64"),
      mimeType: "application/zip",
    });
  });
});
