import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDocumentTools, pollConsumeTask } from "./documents";
import {
  createMockServer,
  createMockApi,
  getTextContent,
} from "./test-helpers";

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

describe("post_document — file input", () => {
  test("unreadable absolute path surfaces guidance to pass base64 instead, without calling the API", async () => {
    let postCalled = false;
    const api = createMockApi({
      postDocument: async () => {
        postCalled = true;
        return "1";
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    // Simulates a remotely-hosted server: the path exists in the caller's
    // sandbox but not on the server's filesystem -> readFile throws ENOENT.
    const missingPath = "/mnt/user-data/outputs/does-not-exist-on-server.pdf";

    await assert.rejects(
      tools.get("post_document")!.callback({
        file: missingPath,
        filename: "does-not-exist-on-server.pdf",
      }),
      (err: Error) => {
        assert.match(
          err.message,
          /base64/i,
          "error should steer the caller toward base64 content"
        );
        assert.match(
          err.message,
          /does-not-exist-on-server\.pdf/,
          "error should echo the path that failed to read"
        );
        return true;
      }
    );

    assert.equal(
      postCalled,
      false,
      "must not attempt the upload when the file could not be read"
    );
  });

  test("file field description scopes the path option to same-machine deployments", () => {
    const api = createMockApi();
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    const shape = tools.get("post_document")!.schema as Record<
      string,
      z.ZodTypeAny
    >;
    const fileDescription = shape.file.description ?? "";

    assert.match(
      fileDescription,
      /base64/i,
      "should present base64 as a/the primary input"
    );
    assert.match(
      fileDescription,
      /same machine|same-machine|locally|local/i,
      "should disclose that the path option only works when the server shares a filesystem"
    );
  });
});

describe("post_document — poll", () => {
  const base64 = Buffer.from("hello").toString("base64");

  test("poll:true returns the new document_id when the consumer task succeeds", async () => {
    const polled: string[] = [];
    const api = createMockApi({
      postDocument: async () => "the-task-uuid",
      request: async (pathAndQuery: string) => {
        polled.push(pathAndQuery);
        return [
          {
            task_id: "the-task-uuid",
            status: "SUCCESS",
            related_document: 42,
            result: "Success. New document id 42 created.",
          },
        ];
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    const result = await tools.get("post_document")!.callback({
      file: base64,
      filename: "x.pdf",
      poll: true,
    });
    const body = getTextContent(result) as Record<string, unknown>;

    assert.equal(body.status, "SUCCESS");
    assert.equal(body.document_id, 42);
    assert.equal(body.task_id, "the-task-uuid");
    assert.ok(
      polled.some((p) => p.includes("task_id=the-task-uuid")),
      "should poll /tasks/ filtered by the returned task_id"
    );
  });

  test("poll:true surfaces the consumer error when the task fails", async () => {
    const api = createMockApi({
      postDocument: async () => "fail-uuid",
      request: async () => [
        {
          task_id: "fail-uuid",
          status: "FAILURE",
          result: "InputFileError: the file is not a valid PDF",
        },
      ],
    });
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    const result = await tools.get("post_document")!.callback({
      file: base64,
      filename: "x.pdf",
      poll: true,
    });
    const body = getTextContent(result) as Record<string, unknown>;

    assert.equal(body.status, "FAILURE");
    assert.match(String(body.result), /InputFileError/);
  });

  test("without poll, returns the task UUID immediately and never queries tasks", async () => {
    let requested = false;
    const api = createMockApi({
      postDocument: async () => "async-uuid",
      request: async () => {
        requested = true;
        return [];
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentTools(server, api);

    const result = await tools.get("post_document")!.callback({
      file: base64,
      filename: "x.pdf",
    });
    const body = getTextContent(result) as Record<string, unknown>;

    assert.equal(body.status, "async-uuid");
    assert.equal(requested, false, "must not poll when poll is not requested");
  });
});

describe("pollConsumeTask", () => {
  test("returns the last non-terminal task once the timeout elapses (never hangs)", async () => {
    const api = createMockApi({
      request: async () => [{ task_id: "slow", status: "STARTED" }],
    });

    // timeoutMs 0 -> exactly one poll, deadline check returns before any sleep.
    const task = await pollConsumeTask(api, "slow", 0);

    assert.equal(task?.status, "STARTED");
  });
});
