import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { createHarness, type E2EHarness } from "./harness";
import { seed, ensureCustomField, type CustomField } from "./setup/seed";
import { eventually, seedDocument, uploadDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

async function fetchDocument(
  token: string,
  id: number
): Promise<{
  owner: number | null;
  correspondent: number | null;
  custom_fields: Array<{ field: number; value: unknown }>;
}> {
  const res = await axios.get(`${BASE_URL}/api/documents/${id}/`, {
    headers: { Authorization: `Token ${token}` },
    timeout: 10_000,
  });
  return res.data as {
    owner: number | null;
    correspondent: number | null;
    custom_fields: Array<{ field: number; value: unknown }>;
  };
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

  test("all + filters reassigns every document of one correspondent to another", async () => {
    const stamp = Date.now();
    const make = async (name: string) =>
      (await axios.post<{ id: number }>(`${BASE_URL}/api/correspondents/`, { name }, {
        headers: { Authorization: `Token ${token}` },
        timeout: 10_000,
      })).data.id;
    const from = await make(`e2e-merge-from-${stamp}`);
    const to = await make(`e2e-merge-to-${stamp}`);
    const [{ id: a }, { id: b }] = await Promise.all([
      seedDocument(token, "bulk-filter-a"),
      seedDocument(token, "bulk-filter-b"),
    ]);
    await harness.callTool("edit_documents_bulk", { documents: [a, b], method: "set_correspondent", correspondent: from });

    await harness.callTool("edit_documents_bulk", {
      all: true,
      filters: { correspondent__id: from },
      method: "set_correspondent",
      correspondent: to,
    });

    const moved = await eventually(async () => {
      const [da, db] = await Promise.all([fetchDocument(token, a), fetchDocument(token, b)]);
      return da.correspondent === to && db.correspondent === to ? true : undefined;
    });
    assert.equal(moved, true);
  });

  test("remove_password with update_document stores an unlocked version", async () => {
    const bytes = await fs.readFile(path.resolve("tests/e2e/fixtures/encrypted-e2e-pass.pdf"));
    const docId = await uploadDocument(token, bytes, `bulk-remove-pw-${Date.now()}.pdf`);

    await harness.callTool("edit_documents_bulk", {
      documents: [docId],
      method: "remove_password",
      password: "e2e-pass",
      update_document: true,
    });

    const versions = await eventually(async () => {
      const res = await axios.get<{ versions: unknown[] }>(`${BASE_URL}/api/documents/${docId}/`, {
        headers: { Authorization: `Token ${token}` },
        timeout: 10_000,
      });
      return res.data.versions.length === 2 ? res.data.versions : undefined;
    }, 60_000);
    assert.equal(versions.length, 2);
  });
});
