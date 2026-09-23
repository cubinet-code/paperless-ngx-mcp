import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { ensureCustomField, seed } from "./setup/seed";
import { buildMinimalPdf, seedDocument, uploadDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

describe("list_documents (e2e) — 3.2 filters", () => {
  let harness: E2EHarness;
  let token: string;
  let docId: number;
  let fieldName: string;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
    const field = await ensureCustomField(token, "e2e-amount", "integer");
    fieldName = field.name;
    ({ id: docId } = await seedDocument(token, "cfq-e2e"));
    await harness.callTool("edit_documents_bulk", {
      documents: [docId],
      method: "modify_custom_fields",
      add_custom_fields: [{ field: field.id, value: 250 }],
    });
  });

  test("custom_field_query takes the JSON expression syntax", async () => {
    const hit = await harness.callTool<{ results: Array<{ id: number }> }>("list_documents", {
      custom_field_query: JSON.stringify([fieldName, "gte", 100]),
      page_size: 100,
    });
    assert.ok(hit.results.some((d) => d.id === docId));
  });

  test("has_duplicates=true lists byte-identical uploads but not a unique document", async () => {
    const bytes = buildMinimalPdf(`dup-e2e-${Date.now()}`);
    const first = await uploadDocument(token, bytes, "dup-e2e-a.pdf");
    const second = await uploadDocument(token, bytes, "dup-e2e-b.pdf");

    const flagged = await harness.callTool<{ results: Array<{ id: number }> }>("list_documents", {
      has_duplicates: true,
      ordering: "-id",
      page_size: 100,
    });
    const ids = flagged.results.map((d) => d.id);

    assert.ok(ids.includes(first) && ids.includes(second), `expected ${first} and ${second} in ${ids}`);
    assert.ok(!ids.includes(docId), "the unique seed document must not be listed as a duplicate");
  });
});
