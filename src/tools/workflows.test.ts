import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerWorkflowTools } from "./workflows";
import { createMockApi, createMockServer, getTextContent } from "./test-helpers";

const MASK = "**********";

const pwAction = { id: 7, type: 5, passwords: ["secret-one", "secret-two"] };
const workflow = { id: 3, name: "wf", triggers: [{ id: 1, type: 2 }], actions: [pwAction] };

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

function setup(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const api = createMockApi({
    request: async (path: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined });
      const key = `${method} ${path.split("?")[0]}`;
      if (!(key in responses)) throw new Error(`unexpected ${key}`);
      return responses[key];
    },
  });
  const { server, tools } = createMockServer();
  registerWorkflowTools(server, api);
  return { calls, tools };
}

describe("workflow PDF passwords are masked on read", () => {
  test("get_workflow, list_workflows, get/list_workflow_action never return the passwords", async () => {
    const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
    const { tools } = setup({
      "GET /workflows/3/": workflow,
      "GET /workflows/": page([workflow]),
      "GET /workflow_actions/7/": pwAction,
      "GET /workflow_actions/": page([pwAction]),
    });

    const outputs = await Promise.all([
      tools.get("get_workflow")!.callback({ id: 3 }),
      tools.get("list_workflows")!.callback({}),
      tools.get("get_workflow_action")!.callback({ id: 7 }),
      tools.get("list_workflow_actions")!.callback({}),
    ]);

    for (const out of outputs) {
      const text = JSON.stringify(getTextContent(out));
      assert.doesNotMatch(text, /secret-/);
      assert.match(text, /\*{10}/);
    }
    assert.deepEqual(
      (getTextContent(outputs[0]) as typeof workflow).actions[0].passwords,
      [MASK, MASK]
    );
  });

  test("create/update responses are masked too", async () => {
    const { tools } = setup({
      "POST /workflows/": workflow,
      "POST /workflow_actions/": pwAction,
    });

    const created = await tools.get("create_workflow")!.callback({
      name: "wf",
      triggers: [{ type: 2 }],
      actions: [{ type: 5, passwords: ["secret-one"] }],
    });
    const action = await tools.get("create_workflow_action")!.callback({ type: 5, passwords: ["secret-one"] });

    assert.doesNotMatch(JSON.stringify(getTextContent(created)), /secret-/);
    assert.doesNotMatch(JSON.stringify(getTextContent(action)), /secret-/);
  });
});

describe("masked passwords sent back keep the stored ones", () => {
  test("update_workflow swaps an all-masked list for the stored passwords of that action", async () => {
    const { calls, tools } = setup({
      "GET /workflows/3/": workflow,
      "PATCH /workflows/3/": workflow,
    });

    await tools.get("update_workflow")!.callback({
      id: 3,
      actions: [{ id: 7, type: 5, passwords: [MASK, MASK] }],
    });

    const patch = calls.find((c) => c.method === "PATCH")!;
    assert.deepEqual(
      (patch.body!.actions as Array<{ passwords: string[] }>)[0].passwords,
      ["secret-one", "secret-two"]
    );
  });

  test("update_workflow passes real passwords through without a lookup", async () => {
    const { calls, tools } = setup({ "PATCH /workflows/3/": workflow });

    await tools.get("update_workflow")!.callback({
      id: 3,
      actions: [{ id: 7, type: 5, passwords: ["new-secret"] }],
    });

    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0].body!.actions as Array<{ passwords: string[] }>)[0].passwords, ["new-secret"]);
  });

  test("update_workflow refuses masked passwords it cannot resolve", async () => {
    const { calls, tools } = setup({ "GET /workflows/3/": workflow });
    const tool = tools.get("update_workflow")!;

    await assert.rejects(
      () => tool.callback({ id: 3, actions: [{ type: 5, passwords: [MASK] }] }),
      /existing action/
    );
    await assert.rejects(
      () => tool.callback({ id: 3, actions: [{ id: 7, type: 5, passwords: [MASK, "new-secret"] }] }),
      /Mixing masked and real/
    );
    assert.ok(calls.every((c) => c.method === "GET"), "must not PATCH");
  });

  test("update_workflow_action swaps an all-masked list for the stored passwords", async () => {
    // Paperless re-validates type 5 on PATCH, so the passwords must be sent,
    // not just omitted.
    const { calls, tools } = setup({
      "GET /workflow_actions/7/": pwAction,
      "PATCH /workflow_actions/7/": pwAction,
    });

    await tools.get("update_workflow_action")!.callback({ id: 7, type: 5, passwords: [MASK, MASK] });

    const patch = calls.find((c) => c.method === "PATCH")!;
    assert.deepEqual(patch.body, { type: 5, passwords: ["secret-one", "secret-two"] });
  });

  test("create_workflow and create_workflow_action refuse masked passwords", async () => {
    const { calls, tools } = setup({});

    await assert.rejects(
      () =>
        tools.get("create_workflow")!.callback({
          name: "copy",
          triggers: [{ type: 2 }],
          actions: [{ type: 5, passwords: [MASK] }],
        }),
      /real passwords/
    );
    await assert.rejects(
      () => tools.get("create_workflow_action")!.callback({ type: 5, passwords: [MASK] }),
      /real passwords/
    );
    assert.equal(calls.length, 0);
  });
});
