import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

interface CustomField {
  id: number;
  name: string;
  data_type: string;
}

async function ensureCustomField(
  token: string,
  name: string,
  data_type: string
): Promise<CustomField> {
  const list = await axios.get<{ results: CustomField[] }>(
    `${BASE_URL}/api/custom_fields/`,
    {
      headers: { Authorization: `Token ${token}` },
      params: { page_size: 100 },
      timeout: 10_000,
    }
  );
  const existing = list.data.results.find((f) => f.name === name);
  if (existing) return existing;

  const res = await axios.post<CustomField>(
    `${BASE_URL}/api/custom_fields/`,
    { name, data_type },
    {
      headers: { Authorization: `Token ${token}` },
      timeout: 10_000,
    }
  );
  return res.data;
}

async function fetchDocument(
  token: string,
  id: number
): Promise<{ owner: number | null; custom_fields: Array<{ field: number; value: unknown }> }> {
  const res = await axios.get(`${BASE_URL}/api/documents/${id}/`, {
    headers: { Authorization: `Token ${token}` },
    timeout: 10_000,
  });
  return res.data as { owner: number | null; custom_fields: Array<{ field: number; value: unknown }> };
}

describe("edit_documents_bulk (e2e) — payload shapes accepted by current Paperless", () => {
  let harness: E2EHarness;
  let token: string;
  let docId: number;
  let stringField: CustomField;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
    [{ id: docId }, stringField] = await Promise.all([
      seedDocument(token, "bulk-edit-e2e"),
      ensureCustomField(token, "e2e-string-field", "string"),
    ]);
  });

  test("modify_custom_fields adds a custom-field value to the document", async () => {
    await harness.callTool("edit_documents_bulk", {
      documents: [docId],
      method: "modify_custom_fields",
      add_custom_fields: [{ field: stringField.id, value: "hello-from-e2e" }],
    });

    const doc = await fetchDocument(token, docId);
    const matched = doc.custom_fields.find((cf) => cf.field === stringField.id);
    assert.ok(matched, "custom field was not assigned to the document");
    assert.equal(matched!.value, "hello-from-e2e");
  });

  test("modify_custom_fields removes the custom-field value", async () => {
    await harness.callTool("edit_documents_bulk", {
      documents: [docId],
      method: "modify_custom_fields",
      remove_custom_fields: [stringField.id],
    });

    const doc = await fetchDocument(token, docId);
    const matched = doc.custom_fields.find((cf) => cf.field === stringField.id);
    assert.equal(matched, undefined, "custom field should have been removed");
  });

  test("set_permissions changes the document owner", async () => {
    const before = await fetchDocument(token, docId);
    const newOwner = before.owner === 1 ? null : 1;

    await harness.callTool("edit_documents_bulk", {
      documents: [docId],
      method: "set_permissions",
      set_permissions: {
        view: { users: [], groups: [] },
        change: { users: [], groups: [] },
      },
      owner: newOwner,
      merge: false,
    });

    const after = await fetchDocument(token, docId);
    assert.equal(after.owner, newOwner);
  });
});
