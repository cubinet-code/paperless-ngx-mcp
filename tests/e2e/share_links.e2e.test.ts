import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

interface Bundle {
  id: number;
  slug: string;
  status: string;
  documents: number[];
}

describe("share links & bundles (e2e)", () => {
  let harness: E2EHarness;
  let docs: number[];

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
    docs = (await Promise.all([seedDocument(token, "share-a"), seedDocument(token, "share-b")])).map((d) => d.id);
  });

  test("single share link: create, list for the document, delete", async () => {
    const link = await harness.callTool<{ id: number; document: number }>("create_share_link", {
      document: docs[0],
    });
    const forDoc = await harness.callTool<Array<{ id: number }>>("list_document_share_links", { id: docs[0] });
    assert.ok(forDoc.some((l) => l.id === link.id));
    await harness.callTool("delete_share_link", { id: link.id, confirm: true });
  });

  test("bundle: create, get, list, rebuild, delete", async () => {
    const bundle = await harness.callTool<Bundle>("create_share_link_bundle", {
      document_ids: docs,
      expiration_days: 7,
      file_version: "original",
    });
    assert.deepEqual([...bundle.documents].sort(), [...docs].sort());
    assert.ok(["pending", "processing", "ready"].includes(bundle.status));

    const fetched = await harness.callTool<Bundle>("get_share_link_bundle", { id: bundle.id });
    assert.equal(fetched.slug, bundle.slug);

    const listed = await harness.callTool<{ results: Bundle[] }>("list_share_link_bundles", { page_size: 100 });
    assert.ok(listed.results.some((b) => b.id === bundle.id));

    const rebuilt = await harness.callTool<Bundle>("rebuild_share_link_bundle", { id: bundle.id });
    assert.equal(rebuilt.id, bundle.id);

    await harness.callTool("delete_share_link_bundle", { id: bundle.id, confirm: true });
    await assert.rejects(() => harness.callTool("get_share_link_bundle", { id: bundle.id }), /HTTP 404/);
  });
});
