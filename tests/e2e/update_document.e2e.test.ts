import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { createHarness, type E2EHarness } from "./harness";
import { findIdByName, seed } from "./setup/seed";
import { seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("update_document (e2e) — safe tag edits", () => {
  let harness: E2EHarness;
  let token: string;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  const storedTags = async (id: number) =>
    (
      await axios.get<{ tags: number[] }>(`${BASE_URL}/api/documents/${id}/`, {
        headers: { Authorization: `Token ${token}` },
        timeout: 10_000,
      })
    ).data.tags.sort();

  test("add_tags / remove_tags keep the other tags and report the diff", async () => {
    const [alpha, beta, gamma] = await Promise.all(
      ["e2e-tag-alpha", "e2e-tag-beta", "e2e-tag-gamma"].map((n) => findIdByName(token, "tags", n))
    );
    const { id } = await seedDocument(token, "safe-tags-e2e");

    const replaced = await harness.callTool<{ tag_changes: { added: number[]; removed: number[] } }>(
      "update_document",
      { id, tags: [alpha, beta] }
    );
    assert.deepEqual(replaced.tag_changes.added.sort(), [alpha, beta].sort());

    const edited = await harness.callTool<{ tag_changes: { added: number[]; removed: number[] } }>(
      "update_document",
      { id, add_tags: [gamma], remove_tags: [alpha] }
    );

    assert.deepEqual(await storedTags(id), [beta, gamma].sort());
    assert.deepEqual(edited.tag_changes, { added: [gamma], removed: [alpha] });
  });
});
