import axios from "axios";
import { Buffer } from "node:buffer";
import { PaperlessAPI } from "../../../src/api/PaperlessAPI";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

/**
 * Builds a minimal but valid 1-page PDF in-memory with a Contents stream that
 * includes `uniqueTag` so the bytes differ across runs (Paperless rejects
 * duplicates by hash). Computing the xref offsets at runtime avoids the
 * hand-counted-byte breakage that hardcoded fixtures hit.
 */
export function buildMinimalPdf(uniqueTag: string): Buffer {
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

export interface E2ETask {
  task_id: string;
  status: string;
  related_document_ids: number[] | null;
  result_data: unknown;
}

const TERMINAL = new Set(["success", "failure", "revoked"]);

export async function waitForTask(
  taskUuid: string,
  token: string,
  timeoutMs = 120_000
): Promise<E2ETask> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await axios.get<{ results: E2ETask[] }>(`${BASE_URL}/api/tasks/`, {
      headers: { Authorization: `Token ${token}` },
      params: { task_id: taskUuid },
      timeout: 10_000,
    });
    const task = res.data.results.find((t) => t.task_id === taskUuid);
    if (task && TERMINAL.has(task.status)) return task;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for task ${taskUuid}`);
}

export async function uploadDocument(
  token: string,
  bytes: Buffer,
  filename: string,
  title?: string
): Promise<number> {
  const api = new PaperlessAPI(BASE_URL, token);
  const response = await api.postDocument(bytes, filename, title ? { title } : {});
  const taskUuid = response.replace(/"/g, "").trim();
  if (!taskUuid) {
    throw new Error(
      `post_document did not return a task UUID; got ${JSON.stringify(response)}`
    );
  }
  const task = await waitForTask(taskUuid, token);
  const id = task.related_document_ids?.[0];
  if (task.status !== "success" || id == null) {
    throw new Error(
      `Consumer task ${taskUuid} ended in ${task.status}: ${JSON.stringify(task.result_data)}`
    );
  }
  return Number(id);
}

export async function seedDocument(
  token: string,
  titlePrefix = "e2e-doc"
): Promise<SeededDocument> {
  const title = `${titlePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = await uploadDocument(token, buildMinimalPdf(title), `${title}.pdf`, title);
  return { id, title };
}

/** Polls `probe` every second until it returns a value (not undefined). */
export async function eventually<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
