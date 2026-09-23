import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("list_tasks (e2e)", () => {
  let harness: E2EHarness;

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
    await seedDocument(token, "list-tasks-e2e"); // guarantees a consume_file task
  });

  test("filters by task_type and honours limit", async () => {
    const tasks = await harness.callTool<Array<{ task_type: string }>>("list_tasks", {
      task_type: "consume_file",
      limit: 3,
    });

    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 1 && tasks.length <= 3, `got ${tasks.length}`);
    assert.ok(tasks.every((t) => t.task_type === "consume_file"));
  });

  test("filters by lowercase status", async () => {
    const tasks = await harness.callTool<Array<{ status: string }>>("list_tasks", {
      status: "success",
      limit: 5,
    });

    assert.ok(tasks.length >= 1);
    assert.ok(tasks.every((t) => t.status === "success"));
  });
});
