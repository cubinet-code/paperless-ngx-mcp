import axios from "axios";
import { Buffer } from "node:buffer";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

/**
 * Builds a minimal but valid 1-page PDF in-memory with a Contents stream that
 * includes `uniqueTag` so the bytes differ across runs (Paperless rejects
 * duplicates by hash). Computing the xref offsets at runtime avoids the
 * hand-counted-byte breakage that hardcoded fixtures hit.
 */
function buildMinimalPdf(uniqueTag: string): Buffer {
  const safeTag = uniqueTag.replace(/[()\\]/g, "_");
  const stream = `BT /F1 24 Tf 72 720 Td (${safeTag}) Tj ET`;
  const objects = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "binary");
}

interface SeededDocument {
  id: number;
  title: string;
}

async function pollForTask(
  taskUuid: string,
  token: string,
  timeoutMs = 120_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await axios.get<
      Array<{ task_id: string; status: string; related_document?: number | string | null }>
    >(`${BASE_URL}/api/tasks/`, {
      headers: { Authorization: `Token ${token}` },
      params: { task_id: taskUuid },
      timeout: 10_000,
    });
    const task = res.data.find((t) => t.task_id === taskUuid);
    if (task && task.status === "SUCCESS" && task.related_document != null) {
      return Number(task.related_document);
    }
    if (task && (task.status === "FAILURE" || task.status === "REVOKED")) {
      throw new Error(`Paperless consumer task ${taskUuid} ended in ${task.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for consumer task ${taskUuid}`);
}

/**
 * Uploads a minimal 1-page PDF with a unique title and waits for the consumer
 * to finish processing it. Returns the resulting document id.
 */
export async function seedDocument(
  token: string,
  titlePrefix = "e2e-doc"
): Promise<SeededDocument> {
  const title = `${titlePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("document", buildMinimalPdf(title), {
    filename: `${title}.pdf`,
    contentType: "application/pdf",
  });
  form.append("title", title);

  const res = await axios.post<string>(
    `${BASE_URL}/api/documents/post_document/`,
    form,
    {
      headers: {
        Authorization: `Token ${token}`,
        ...form.getHeaders(),
      },
      timeout: 30_000,
    }
  );

  const taskUuid =
    typeof res.data === "string" ? res.data.replace(/"/g, "").trim() : "";
  if (!taskUuid) {
    throw new Error(
      `post_document did not return a task UUID; got ${JSON.stringify(res.data)}`
    );
  }
  const id = await pollForTask(taskUuid, token);
  return { id, title };
}
