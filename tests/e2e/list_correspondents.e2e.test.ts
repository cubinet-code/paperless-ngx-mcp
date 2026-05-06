import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, E2EHarness } from "./harness";
import { seed } from "./setup/seed";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("list_correspondents (e2e) — regression for is_empty filter", () => {
  let harness: E2EHarness;

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
  });

  test("is_empty: true returns only correspondents with document_count === 0 and a consistent count", async () => {
    const body = await harness.callTool<{
      count: number;
      next: null;
      previous: null;
      all: number[];
      results: Array<{ id: number; name: string; document_count: number }>;
    }>("list_correspondents", { is_empty: true });

    assert.equal(body.next, null, "filtered response should not advertise more pages");
    assert.equal(body.previous, null);
    assert.equal(
      body.count,
      body.results.length,
      "count must match results.length when filtered"
    );
    assert.equal(
      body.all.length,
      body.results.length,
      "all must match results.length when filtered (no stale unfiltered ids)"
    );
    for (const c of body.results) {
      assert.equal(
        c.document_count,
        0,
        `correspondent ${c.name} (id=${c.id}) leaked through is_empty:true filter with count ${c.document_count}`
      );
    }
    assert.ok(
      body.results.length >= 1,
      "expected at least one seeded empty correspondent"
    );
  });

  test("no is_empty preserves the server's pagination shape", async () => {
    const body = await harness.callTool<{
      count: number;
      next: string | null;
      results: unknown[];
    }>("list_correspondents", {});
    assert.ok(body.count >= body.results.length);
  });
});
