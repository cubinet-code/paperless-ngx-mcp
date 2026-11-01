import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createMockApi } from "./test-helpers";
import {
  inspectDocumentPdf, renderDocumentPdfPage, verifyPdfBytes, parsePdfPageCount,
  PdfAccessError
} from "./pdfSupport";
import { registerPdfTools } from "./pdf";
import { createMockServer, getTextContent } from "./test-helpers";

/**
 * Fully self-contained, two-page PDF with Helvetica text. No binary fixtures,
 * scanned documents, tokens, or personal data are committed to the repository.
 */
function smallTwoPagePdf(): Buffer {
  const textStream = (s: string) => {
    const stream = `BT /F1 12 Tf 30 250 Td (${s}) Tj ET`;
    return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    textStream("Page One"),
    textStream("Page Two"),
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(body);
  body += "xref\n0 8\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("safe PDF access", () => {
  test("validates MIME signature and 50 MiB cap", () => {
    verifyPdfBytes(smallTwoPagePdf(), "application/pdf");
    assert.throws(() => verifyPdfBytes(Buffer.from("HTML"), "text/html"), (e: unknown) =>
      e instanceof PdfAccessError && e.code === "not_a_pdf");
    assert.throws(
      () => verifyPdfBytes(Buffer.alloc(50 * 1024 * 1024 + 1), "application/pdf"),
      (e: unknown) => e instanceof PdfAccessError && e.code === "source_too_large"
    );
  });

  test("parses page count from Poppler output", () => {
    assert.equal(parsePdfPageCount("Title: Example\nPages: 12\nSize: 4"), 12);
    assert.throws(() => parsePdfPageCount("No page field"),
      (e: unknown) => e instanceof PdfAccessError && e.code === "page_count_unknown");
  });

  test("PDF pages render and text can be extracted independently", async () => {
    const pdf = smallTwoPagePdf();
    const api = createMockApi({
      downloadDocument: async () => ({
        data: pdf,
        headers: { "content-type": "application/pdf" },
      }),
    });
    const info = await inspectDocumentPdf(api, 7);
    assert.equal(info.pageCount, 2);
    assert.equal(info.sizeBytes, pdf.byteLength);

    const second = await renderDocumentPdfPage(api, 7, 2, 900);
    assert.equal(second.pageCount, 2);
    assert.equal(second.page, 2);
    assert.match(second.text, /Page Two/);
    assert.doesNotMatch(second.text, /Page One/);
    assert.equal(second.image[0], 0xff);
    assert.equal(second.image[1], 0xd8);
    assert.ok(second.image.byteLength < 1_500_000);
    await assert.rejects(
      () => renderDocumentPdfPage(api, 7, 3),
      (e: unknown) => e instanceof PdfAccessError && e.code === "page_out_of_range"
    );
  });

  test("MCP PDF tools return small metadata and one image per page", async () => {
    const pdf = smallTwoPagePdf();
    const { server, tools } = createMockServer();
    registerPdfTools(server, createMockApi({
      downloadDocument: async () => ({ data: pdf, headers: { "content-type": "application/pdf" } }),
    }));
    const info = getTextContent(
      await tools.get("get_document_pdf_info")!.callback({ id: 7 })
    ) as { pageCount: number };
    assert.equal(info.pageCount, 2);

    const page = await tools.get("get_document_pdf_page")!.callback({ id: 7, page: 2, max_dimension: 900 });
    const image = page.content.find((x) => x.type === "image");
    assert.equal(image?.type, "image");
    const payload = getTextContent(page) as { page: number; pageCount: number; selectableText: string };
    assert.equal(payload.page, 2);
    assert.equal(payload.pageCount, 2);
    assert.match(payload.selectableText, /Page Two/);
  });
});
