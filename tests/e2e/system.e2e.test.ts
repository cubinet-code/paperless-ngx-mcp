import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("system & task insight tools (e2e)", () => {
  let harness: E2EHarness;
  let token: string;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  test("get_system_status reports the Paperless version", async () => {
    const status = await harness.callTool<{ pngx_version: string }>("get_system_status");
    assert.match(status.pngx_version, /^3\.2\./);
  });

  test("task insight tools return their documented shapes", async () => {
    const counts = await harness.callTool<Record<string, number>>("get_task_status_counts");
    assert.equal(typeof counts.all, "number");

    const summary = await harness.callTool<Array<{ task_type: string }>>("get_task_summary", { days: 7 });
    assert.ok(Array.isArray(summary));

    const active = await harness.callTool<unknown[]>("list_active_tasks");
    assert.ok(Array.isArray(active));
  });

  test("get_document_ai_suggestions explains when AI is disabled", async () => {
    const { id } = await seedDocument(token, "ai-suggestions-e2e");
    await assert.rejects(
      () => harness.callTool("get_document_ai_suggestions", { id }),
      /AI is required for this feature \(HTTP 400\)/
    );
  });

  test("list_trash lists trashed documents without their content", async () => {
    const { id } = await seedDocument(token, "trash-e2e");
    await harness.callTool("delete_document", { id, confirm: true });

    const trash = await harness.callTool<{ results: Array<Record<string, unknown>> }>("list_trash", { page_size: 100 });
    const entry = trash.results.find((d) => d.id === id);

    assert.ok(entry, "trashed document is listed");
    assert.equal("content" in entry!, false);
    await harness.callTool("empty_trash", { documents: [id], confirm: true });
  });
});
