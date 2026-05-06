import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, E2EHarness } from "./harness";
import { seed } from "./setup/seed";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("list_tags (e2e) — regression for is_empty filter", () => {
  let harness: E2EHarness;

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
  });

  test("is_empty: true returns only tags with document_count === 0 and a consistent count", async () => {
    const body = await harness.callTool<{
      count: number;
      next: null;
      previous: null;
      all: number[];
      results: Array<{ id: number; name: string; document_count: number }>;
    }>("list_tags", { is_empty: true });

    assert.equal(body.next, null);
    assert.equal(body.previous, null);
    assert.equal(body.count, body.results.length);
    assert.equal(body.all.length, body.results.length);
    for (const t of body.results) {
      assert.equal(
        t.document_count,
        0,
        `tag ${t.name} (id=${t.id}) leaked through is_empty:true with count ${t.document_count}`
      );
    }
    assert.ok(body.results.length >= 1, "expected at least one seeded empty tag");
  });
});
