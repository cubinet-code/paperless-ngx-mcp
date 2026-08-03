import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
  test("uses supported filter parameters", async () => {
    let calledPath: string | undefined;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        calledPath = path;
        return [];
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    await tool.callback({ status: "success", task_name: "consume_file" });

    assert.ok(calledPath!.includes("status=success"));
    assert.ok(calledPath!.includes("task_name=consume_file"));
    // Should NOT have task_id
    assert.ok(!calledPath!.includes("task_id"));
  });

  test("falls back to uppercase status when the server rejects lowercase (Paperless 2.x)", async () => {
    const calledPaths: string[] = [];
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        calledPaths.push(path);
        // 2.x rejects lowercase statuses with a 400.
        if (path.includes("status=success")) {
          throw new Error("Request failed with status code 400 (HTTP 400)");
        }
        return [];
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    await tool.callback({ status: "success" });

    assert.equal(calledPaths.length, 2, "should retry once with the other casing");
    assert.ok(calledPaths[0].includes("status=success"));
    assert.ok(calledPaths[1].includes("status=SUCCESS"));

    // The accepted casing is remembered, so the next call goes straight there.
    calledPaths.length = 0;
    await tool.callback({ status: "failure" });
    assert.deepEqual(calledPaths.length, 1);
    assert.ok(calledPaths[0].includes("status=FAILURE"));
  });

  test("passes through the Paperless 3.x task_type and trigger_source filters", async () => {
    let calledPath: string | undefined;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        calledPath = path;
        return { count: 0, next: null, previous: null, results: [] };
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    await tool.callback({
      task_type: "consume_file",
      trigger_source: "api_upload",
    });

    assert.ok(calledPath!.includes("task_type=consume_file"));
    assert.ok(calledPath!.includes("trigger_source=api_upload"));
  });

  test("works with no filters", async () => {
    let calledPath: string | undefined;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (path: string) => {
        calledPath = path;
        return [];
      },
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    await tool.callback({});

    assert.equal(calledPath, "/tasks/");
  });

  test("limits results client-side with limit parameter", async () => {
    const fakeTasks = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      task_id: `task-${i + 1}`,
      task_name: "consume_file",
      status: "SUCCESS",
      date_created: `2026-01-${String(i + 1).padStart(2, "0")}`,
    }));
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (_path: string) => fakeTasks,
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    const result = await tool.callback({ limit: 10 });
    const parsed = getTextContent(result) as any[];

    assert.equal(parsed.length, 10);
    assert.equal(parsed[0].id, 1);
    assert.equal(parsed[9].id, 10);
  });

  test("handles the paginated /tasks/ envelope returned by Paperless 3.x", async () => {
    const fakeTasks = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      task_id: `task-${i + 1}`,
      task_name: "consume_file",
      status: "SUCCESS",
    }));
    const { server, tools } = createMockServer();
    const api = createMockApi({
      // Paperless 3.0 paginates /tasks/; 2.x returned a bare array.
      request: async (_path: string) => ({
        count: fakeTasks.length,
        next: null,
        previous: null,
        results: fakeTasks,
      }),
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    const result = await tool.callback({ limit: 5 });
    const parsed = getTextContent(result) as any[];

    assert.ok(Array.isArray(parsed), "must return an array, not the envelope");
    assert.equal(parsed.length, 5);
    assert.equal(parsed[0].task_id, "task-1");
  });

  test("defaults to 25 results when no limit specified and array is large", async () => {
    const fakeTasks = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      task_id: `task-${i + 1}`,
      task_name: "consume_file",
      status: "SUCCESS",
    }));
    const { server, tools } = createMockServer();
    const api = createMockApi({
      request: async (_path: string) => fakeTasks,
    });
    registerSystemTools(server, api);

    const tool = tools.get("list_tasks")!;
    const result = await tool.callback({});
    const parsed = getTextContent(result) as any[];

    assert.equal(parsed.length, 25);
  });
});

