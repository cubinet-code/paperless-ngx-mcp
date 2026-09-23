import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerSystemTools } from "./system";
import { createMockServer, createMockApi, getTextContent } from "./test-helpers";

describe("delete_document tool", () => {
  test("requires confirm=true", async () => {
    const { server, tools } = createMockServer();
    const api = createMockApi({
      deleteDocument: async () => {},
    });
    registerSystemTools(server, api);

    const tool = tools.get("delete_document")!;
    await assert.rejects(
      () => tool.callback({ id: 1, confirm: false }),
      (err: Error) => {
        assert.match(err.message, /[Cc]onfirmation required/);
        return true;
      }
    );
  });

  test("calls deleteDocument when confirmed", async () => {
    let deletedId: number | undefined;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      deleteDocument: async (id: number) => {
        deletedId = id;
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("delete_document")!;
    const result = await tool.callback({ id: 42, confirm: true });
    assert.equal(deletedId, 42);
    assert.deepEqual(getTextContent(result), { status: "deleted" });
  });
});

describe("delete_document_note tool", () => {
  test("requires confirm=true", async () => {
    const { server, tools } = createMockServer();
    const api = createMockApi();
    registerSystemTools(server, api);

    const tool = tools.get("delete_document_note")!;
    await assert.rejects(
      () => tool.callback({ id: 1, note_id: 2, confirm: false }),
      (err: Error) => {
        assert.match(err.message, /[Cc]onfirmation required/);
        return true;
      }
    );
  });

  test("calls correct endpoint with path segment (not query param)", async () => {
    let calledPath: string | undefined;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string, opts: any) => {
        calledPath = path;
        return {};
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("delete_document_note")!;
    await tool.callback({ id: 5, note_id: 10, confirm: true });

    // Should use path segment, NOT query parameter
    assert.equal(calledPath, "/documents/5/notes/10/");
    assert.ok(!calledPath!.includes("?id="), "Should not use query param for note_id");
  });
});

describe("empty_trash tool", () => {
  test("requires confirm=true", async () => {
    const { server, tools } = createMockServer();
    const api = createMockApi();
    registerSystemTools(server, api);

    const tool = tools.get("empty_trash")!;
    await assert.rejects(
      () => tool.callback({ confirm: false }),
      (err: Error) => {
        assert.match(err.message, /[Cc]onfirmation required/);
        return true;
      }
    );
  });

  test("uses 'empty' action (not 'delete')", async () => {
    let sentBody: any;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (_path: string, opts: any) => {
        sentBody = JSON.parse(opts.body);
        return {};
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("empty_trash")!;
    await tool.callback({ documents: [1, 2], confirm: true });

    assert.equal(sentBody.action, "empty");
    assert.notEqual(sentBody.action, "delete");
  });

  test("allows omitting documents array (empty entire trash)", async () => {
    let sentBody: any;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (_path: string, opts: any) => {
        sentBody = JSON.parse(opts.body);
        return {};
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("empty_trash")!;
    await tool.callback({ confirm: true });

    assert.equal(sentBody.action, "empty");
    assert.equal(sentBody.documents, undefined);
  });
});

describe("list_tasks tool", () => {
  const page = (results: unknown[]) => ({
    count: results.length,
    next: null,
    previous: null,
    results,
  });

  test("forwards status, task_type and trigger_source filters", async () => {
    let calledPath = "";
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        calledPath = path;
        return page([]);
      },
    });
    registerSystemTools(server, api);

    await tools.get("list_tasks")!.callback({
      status: "success",
      task_type: "consume_file",
      trigger_source: "api_upload",
    });

    assert.ok(calledPath.includes("status=success"));
    assert.ok(calledPath.includes("task_type=consume_file"));
    assert.ok(calledPath.includes("trigger_source=api_upload"));
  });

  test("asks the server for `limit` tasks (default 25) and returns the results array", async () => {
    const paths: string[] = [];
    const tasks = [{ id: 1, task_id: "t1", status: "success" }];
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        paths.push(path);
        return page(tasks);
      },
    });
    registerSystemTools(server, api);
    const tool = tools.get("list_tasks")!;

    const result = await tool.callback({ limit: 5 });
    await tool.callback({});

    assert.deepEqual(getTextContent(result), tasks);
    assert.ok(paths[0].includes("page_size=5"), paths[0]);
    assert.ok(paths[1].includes("page_size=25"), paths[1]);
  });

  test("task_type accepts apply_ai_suggestions and the 2.x-only filters are gone", () => {
    const { server, tools } = createMockServer();
    registerSystemTools(server, createMockApi({}));
    const shape = tools.get("list_tasks")!.schema as z.ZodRawShape;

    assert.doesNotThrow(() =>
      z.object(shape).parse({ task_type: "apply_ai_suggestions" })
    );
    assert.equal("task_name" in shape, false);
    assert.equal("type" in shape, false);
  });
});

