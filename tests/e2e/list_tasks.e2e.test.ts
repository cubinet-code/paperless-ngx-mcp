import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, E2EHarness } from "./harness";
import { seed } from "./setup/seed";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

/**
 * Paperless 3.0 paginated `/tasks/` (2.x returned a bare array) and lowercased
 * the status vocabulary (`SUCCESS` -> `success`), rejecting the other casing
 * with a 400. These run against the 2.x container, so they pin the older half
 * of that contract — the 3.x half is covered by the unit tests.
 */
describe("list_tasks (e2e) — Paperless version tolerance", () => {
  let harness: E2EHarness;

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
  });

  test("returns a plain array whatever list shape the server uses", async () => {
    const tasks = await harness.callTool<unknown>("list_tasks");

    assert.ok(
      Array.isArray(tasks),
      "list_tasks must unwrap the paginated envelope rather than leak it"
    );
  });

  test("status filter works against a server that requires uppercase", async () => {
    // The tool exposes the 3.x lowercase vocabulary. A 2.x server 400s on it,
    // so this only passes if the uppercase fallback kicks in.
    const tasks = await harness.callTool<unknown>("list_tasks", {
      status: "success",
    });

    assert.ok(Array.isArray(tasks));
  });

  test("limit truncates the returned list", async () => {
    const tasks = await harness.callTool<unknown[]>("list_tasks", { limit: 1 });

    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length <= 1);
  });
});
