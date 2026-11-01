import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PaperlessAPI } from "../api/PaperlessAPI";

const execFile = promisify(execFileCallback);
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_TEXT_CHARACTERS = 14_000;

/**
 * All commands use execFile (never a shell) with fixed executables. The PDF
 * bytes and raster are temporary, private (0700 directory) and deleted even
 * on failure. No Paperless tokens or document contents are logged.
 */
async function poppler(command: string, args: string[], timeout = 20000) {
  return execFile(command, args, {
    timeout,
    maxBuffer: 256 * 1024,
    env: { ...process.env, LC_ALL: "C", OMP_THREAD_LIMIT: "1" },
  });
}

export interface PdfDocumentInfo {
  pageCount: number;
  sizeBytes: number;
}

export interface PdfRenderedPage extends PdfDocumentInfo {
  page: number;
  image: Buffer;
  text: string;
  textTruncated: boolean;
  pixelLimit: number;
}

export class PdfAccessError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PdfAccessError";
  }
}

export function verifyPdfBytes(bytes: Buffer, contentType: string | undefined): void {
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new PdfAccessError(
      "source_too_large",
      "The document exceeds the 50 MiB page-rendering limit. Use Paperless directly for this exceptionally large file."
    );
  }
  const header = bytes.subarray(0, 1024).toString("latin1");
  if (!header.includes("%PDF-")) {
    throw new PdfAccessError(
      "not_a_pdf",
      `Paperless returned ${contentType || "an unknown MIME type"} rather than a readable PDF. Try the archived document version.`
    );
  }
}

/** Parse only the bounded, fixed-format "Pages:" output, not untrusted metadata. */
export function parsePdfPageCount(pdfinfoOutput: string): number {
  const match = /^Pages:\s*(\d+)\s*$/m.exec(pdfinfoOutput);
  const count = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new PdfAccessError("page_count_unknown", "Could not identify the page count of the PDF.");
  }
  return count;
}

async function withDocumentPdf<T>(
  api: PaperlessAPI,
  id: number,
  processPdf: (filePath: string, info: PdfDocumentInfo, directory: string) => Promise<T>
): Promise<T> {
  const response = await api.downloadDocument(id, false, MAX_SOURCE_BYTES);
  const bytes = Buffer.from(response.data);
  const contentType = String(response.headers?.["content-type"] || "application/pdf");
  verifyPdfBytes(bytes, contentType);

  const directory = await mkdtemp(join(tmpdir(), "paperless-pdf-"));
  try {
    const filePath = join(directory, "document.pdf");
    await writeFile(filePath, bytes, { mode: 0o600 });
    let pdfInfoOutput: string;
    try {
      ({ stdout: pdfInfoOutput } = await poppler("pdfinfo", [filePath]));
    } catch {
      throw new PdfAccessError("pdf_inspection_failed", "Poppler could not inspect the PDF. It may be corrupt or encrypted.");
    }
    const info = { pageCount: parsePdfPageCount(pdfInfoOutput), sizeBytes: bytes.byteLength };
    return await processPdf(filePath, info, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectDocumentPdf(
  api: PaperlessAPI,
  documentId: number
): Promise<PdfDocumentInfo> {
  return withDocumentPdf(api, documentId, async (_path, info) => info);
}

export async function renderDocumentPdfPage(
  api: PaperlessAPI,
  documentId: number,
  page: number,
  requestedPixels: number = 1400
): Promise<PdfRenderedPage> {
  return withDocumentPdf(api, documentId, async (filePath, info, directory) => {
    if (!Number.isInteger(page) || page < 1 || page > info.pageCount) {
      throw new PdfAccessError(
        "page_out_of_range",
        `Requested page ${page} is outside this PDF (pages 1-${info.pageCount}).`
      );
    }
    let text = "";
    try {
      const result = await poppler("pdftotext", [
        "-f", String(page), "-l", String(page),
        "-layout", "-enc", "UTF-8", filePath, "-"
      ]);
      text = result.stdout;
    } catch {
      // Scans and encrypted text layers might not have selectable text.
    }
    const textTruncated = text.length > MAX_TEXT_CHARACTERS;
    if (textTruncated) text = text.slice(0, MAX_TEXT_CHARACTERS);

    let image: Buffer | undefined;
    let pixelLimit = requestedPixels;
    for (const pixels of [requestedPixels, Math.min(requestedPixels, 900)]) {
      pixelLimit = pixels;
      const output = join(directory, `page-${pixels}`);
      try {
        await poppler("pdftoppm", [
          "-f", String(page), "-l", String(page), "-singlefile",
          "-scale-to", String(pixels), "-jpeg", "-jpegopt", "quality=75",
          filePath, output,
        ], 30000);
        image = await readFile(`${output}.jpg`);
      } catch {
        throw new PdfAccessError(
          "page_render_failed",
          "Could not render this PDF page. It may be encrypted or unsupported by Poppler."
        );
      }
      if (image.byteLength <= MAX_IMAGE_BYTES) break;
    }
    if (!image || image.byteLength > MAX_IMAGE_BYTES) {
      throw new PdfAccessError(
        "page_image_too_large",
        "The rendered page exceeds the 1.5 MB MCP image limit even at reduced resolution."
      );
    }
    return { ...info, page, image, text, textTruncated, pixelLimit };
  });
}
