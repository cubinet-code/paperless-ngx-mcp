import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isTerminalTaskStatus, pollConsumeTask } from "./tasks";
import { createMockApi } from "../test-helpers";

const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

describe("isTerminalTaskStatus", () => {
  test("recognises success, failure and revoked", () => {
    for (const s of ["success", "failure", "revoked"]) {
      assert.equal(isTerminalTaskStatus(s), true, s);
    }
  });

  test("treats pending, started and a missing status as non-terminal", () => {
    assert.equal(isTerminalTaskStatus("pending"), false);
    assert.equal(isTerminalTaskStatus("started"), false);
    assert.equal(isTerminalTaskStatus(undefined), false);
  });
});

describe("pollConsumeTask", () => {
  test("returns the last non-terminal task once the timeout elapses (never hangs)", async () => {
    const api = createMockApi({
      request: async () => page([{ task_id: "slow", status: "started" }]),
    });

    // timeoutMs 0 -> exactly one poll, deadline check returns before any sleep.
    const task = await pollConsumeTask(api, "slow", 0);

    assert.equal(task?.status, "started");
  });

  test("finds the finished task in the paginated /tasks/ response", async () => {
    const api = createMockApi({
      request: async () =>
        page([{ task_id: "done", status: "success", related_document_ids: [42] }]),
    });

    const task = await pollConsumeTask(api, "done", 0);

    assert.equal(task?.status, "success");
    assert.deepEqual(task?.related_document_ids, [42]);
  });
});
