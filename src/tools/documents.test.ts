import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDocumentTools } from "./documents";
import { createMockServer, createMockApi, getTextContent } from "./test-helpers";

function getZodSchemaShape(toolSchema: unknown): z.ZodObject<z.ZodRawShape> {
  return z.object(toolSchema as z.ZodRawShape);
}

interface BulkEditCall {
  documents: number[];
  method: string;
  parameters: Record<string, unknown>;
}

function bulkEditCapture(): {
  calls: BulkEditCall[];
  api: ReturnType<typeof createMockApi>;
} {
  const calls: BulkEditCall[] = [];
  const api = createMockApi({
    bulkEditDocuments: async (
      documents: number[],
      method: string,
      parameters: Record<string, unknown>
    ) => {
      calls.push({ documents, method, parameters });
      return { result: "OK" };
    },
    convertDocumentsResponse: async (response: unknown) => response,
  });
  return { calls, api };
}

describe("edit_documents_bulk — modify_custom_fields", () => {
  test("translates [{field, value}] array to upstream {id: value} dict and forwards remove_custom_fields", async () => {
    const { calls, api } = bulkEditCapture();
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    await tools.get("edit_documents_bulk")!.callback({
      documents: [1, 2],
      method: "modify_custom_fields",
      add_custom_fields: [
        { field: 5, value: "hello" },
        { field: 7, value: 42 },
      ],
      remove_custom_fields: [9, 10],
    });

    assert.equal(calls.length, 1);
    const params = calls[0].parameters;
    assert.deepEqual(
      params.add_custom_fields,
      { "5": "hello", "7": 42 },
      "add_custom_fields must be a {id: value} dict on the wire"
    );
    assert.deepEqual(params.remove_custom_fields, [9, 10]);
    assert.ok(
      !("assign_custom_fields" in params),
      "must not emit legacy assign_custom_fields"
    );
    assert.ok(
      !("assign_custom_fields_values" in params),
      "must not emit legacy assign_custom_fields_values"
    );
  });
});

describe("edit_documents_bulk — set_permissions", () => {
  test("schema accepts top-level set_permissions/owner/merge (not nested permissions)", () => {
    const { server, tools } = createMockServer();
    registerDocumentTools(server, createMockApi({}));
    const schema = getZodSchemaShape(tools.get("edit_documents_bulk")!.schema);

    const parsed = schema.parse({
      documents: [1],
      method: "set_permissions",
      set_permissions: {
        view: { users: [1], groups: [] },
        change: { users: [], groups: [2] },
      },
      owner: 1,
      merge: true,
    });
    assert.deepEqual(parsed.set_permissions, {
      view: { users: [1], groups: [] },
      change: { users: [], groups: [2] },
    });
    assert.equal(parsed.owner, 1);
    assert.equal(parsed.merge, true);
  });

  test("body emits set_permissions, owner, and merge as siblings at parameters root", async () => {
    const { calls, api } = bulkEditCapture();
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    await tools.get("edit_documents_bulk")!.callback({
      documents: [1, 2],
      method: "set_permissions",
      set_permissions: {
        view: { users: [1], groups: [] },
        change: { users: [], groups: [2] },
      },
      owner: 1,
      merge: true,
    });

    const params = calls[0].parameters;
    assert.deepEqual(params.set_permissions, {
      view: { users: [1], groups: [] },
      change: { users: [], groups: [2] },
    });
    assert.equal(params.owner, 1);
    assert.equal(params.merge, true);
    assert.ok(
      !("permissions" in params),
      "must not wrap payload in legacy permissions object"
    );
  });
});

describe("edit_documents_bulk — edit_pdf", () => {
  test("schema's method enum includes edit_pdf", () => {
    const { server, tools } = createMockServer();
    registerDocumentTools(server, createMockApi({}));
    const schema = getZodSchemaShape(tools.get("edit_documents_bulk")!.schema);

    const parsed = schema.parse({
      documents: [42],
      method: "edit_pdf",
      operations: [{ page: 1, rotate: 90 }],
    });
    assert.equal(parsed.method, "edit_pdf");
  });

  test("body accepts edit_pdf method and forwards operations + flags", async () => {
    const { calls, api } = bulkEditCapture();
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    await tools.get("edit_documents_bulk")!.callback({
      documents: [42],
      method: "edit_pdf",
      operations: [{ page: 1, rotate: 90 }],
      update_document: true,
      include_metadata: false,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "edit_pdf");
    assert.deepEqual(calls[0].parameters.operations, [{ page: 1, rotate: 90 }]);
    assert.equal(calls[0].parameters.update_document, true);
    assert.equal(calls[0].parameters.include_metadata, false);
  });
});
