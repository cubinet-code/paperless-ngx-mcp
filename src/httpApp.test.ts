import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { createHttpApp, HttpApp } from "./httpApp";

const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1" },
  },
};

interface Reply {
  status: number;
  sessionId: string | null;
  body: string;
}

function makeRequester(baseUrl: string) {
  return async function call(
    body: unknown,
    sessionId?: string,
    method = "POST"
  ): Promise<Reply> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const res = await fetch(`${baseUrl}/mcp`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      sessionId: res.headers.get("mcp-session-id"),
      body: await res.text(),
    };
  };
}

describe("createHttpApp — streamable HTTP sessions", () => {
  let httpApp: HttpApp;
  let listener: Server;
  let call: ReturnType<typeof makeRequester>;

  before(async () => {
    // No request reaches Paperless: initialize and session routing are handled
    // entirely by the MCP transport, so an unreachable base URL is fine.
    const api = new PaperlessAPI("http://127.0.0.1:1/api", "token");
    httpApp = createHttpApp({
      api,
      publicUrl: "http://example.invalid",
      sessionIdleTimeoutMs: 50,
      // Long interval: the tests drive sweepIdleSessions() directly.
      sweepIntervalMs: 60_000,
    });
    listener = await new Promise<Server>((resolve) => {
      const s = httpApp.app.listen(0, () => resolve(s));
    });
    const { port } = listener.address() as { port: number };
    call = makeRequester(`http://127.0.0.1:${port}`);
  });

  after(async () => {
    await httpApp.shutdown();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });

  test("initialize issues a session id", async () => {
    const res = await call(INIT_BODY);

    assert.equal(res.status, 200);
    assert.ok(res.sessionId, "must return an Mcp-Session-Id header");
  });

  test("two concurrent clients each get their own working session", async () => {
    // Regression: a single shared McpServer made the second initialize fail with
    // "Already connected to a transport" (HTTP 500).
    const [a, b] = await Promise.all([call(INIT_BODY), call(INIT_BODY)]);

    assert.equal(a.status, 200, `client A initialize failed: ${a.body}`);
    assert.equal(b.status, 200, `client B initialize failed: ${b.body}`);
    assert.ok(a.sessionId && b.sessionId);
    assert.notEqual(a.sessionId, b.sessionId, "sessions must be distinct");

    // Both sessions must still be independently usable.
    const listA = await call(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      a.sessionId!
    );
    const listB = await call(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      b.sessionId!
    );
    assert.equal(listA.status, 200);
    assert.equal(listB.status, 200);
    assert.match(listA.body, /list_documents/);
    assert.match(listB.body, /list_documents/);
  });

  test("a request with an unknown session id is rejected with 404", async () => {
    const res = await call(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      "00000000-0000-0000-0000-000000000000"
    );

    assert.equal(res.status, 404);
    assert.match(res.body, /Session not found/);
  });

  test("a non-initialize request without a session id is rejected with 400", async () => {
    const res = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    assert.equal(res.status, 400);
    assert.match(res.body, /No valid session ID provided/);
  });

  test("DELETE terminates the session and evicts it", async () => {
    const init = await call(INIT_BODY);
    const sessionId = init.sessionId!;
    const before = httpApp.sessionCount();

    const del = await call(undefined, sessionId, "DELETE");
    assert.equal(del.status, 200);

    assert.equal(
      httpApp.sessionCount(),
      before - 1,
      "session must be removed from the map"
    );

    const after = await call(
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
      sessionId
    );
    assert.equal(after.status, 404, "terminated session must not be reusable");
  });

  test("GET without a session id is a 400, not a 404", async () => {
    // Missing-but-required is a bad request; 404 is reserved for a session id
    // that was supplied but is unknown or expired.
    const res = await call(undefined, undefined, "GET");

    assert.equal(res.status, 400);
    assert.match(res.body, /Mcp-Session-Id required/);
  });

  test("GET with an unknown session id is a 404", async () => {
    const res = await call(
      undefined,
      "00000000-0000-0000-0000-000000000000",
      "GET"
    );

    assert.equal(res.status, 404);
  });

  test("idle sessions are swept, active ones survive", async () => {
    const idle = await call(INIT_BODY);
    const active = await call(INIT_BODY);
    assert.ok(idle.sessionId && active.sessionId);

    // sessionIdleTimeoutMs is 50ms for this suite.
    await new Promise((r) => setTimeout(r, 80));
    // Touch only the active session so it stays past the cutoff.
    await call(
      { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
      active.sessionId!
    );

    const evicted = httpApp.sweepIdleSessions();
    assert.ok(evicted >= 1, "the idle session should have been evicted");

    const idleRes = await call(
      { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} },
      idle.sessionId!
    );
    assert.equal(idleRes.status, 404, "swept session must be gone");

    const activeRes = await call(
      { jsonrpc: "2.0", id: 6, method: "tools/list", params: {} },
      active.sessionId!
    );
    assert.equal(activeRes.status, 200, "recently used session must survive");
  });
});

describe("createHttpApp — session pressure", () => {
  test("a client holding an open GET stream is never swept", async () => {
    // Regression: lastSeenMs was stamped only at request entry, so a client
    // holding the standard GET /mcp stream aged out while still connected —
    // and the SDK client has no 404 recovery path.
    const api = new PaperlessAPI("http://127.0.0.1:1/api", "token");
    const httpApp = createHttpApp({
      api,
      publicUrl: undefined,
      sessionIdleTimeoutMs: 30,
      sweepIntervalMs: 60_000,
    });
    const listener = await new Promise<Server>((resolve) => {
      const s = httpApp.app.listen(0, () => resolve(s));
    });
    const { port } = listener.address() as { port: number };
    const call = makeRequester(`http://127.0.0.1:${port}`);

    try {
      const init = await call(INIT_BODY);
      const sessionId = init.sessionId!;

      // Open the streaming GET and hold it, without consuming it to completion.
      const controller = new AbortController();
      const streamRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "Mcp-Session-Id": sessionId,
        },
        signal: controller.signal,
      });
      assert.equal(streamRes.status, 200);

      await new Promise((r) => setTimeout(r, 60));
      const evicted = httpApp.sweepIdleSessions();
      assert.equal(evicted, 0, "a streaming session must not be evicted");

      const still = await call(
        { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
        sessionId
      );
      assert.equal(still.status, 200, "connected client must stay usable");
      controller.abort();
    } finally {
      await httpApp.shutdown();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  test("new sessions are refused with 503 once the cap is reached", async () => {
    // Each session pins a full McpServer, so an uncapped, unauthenticated
    // endpoint OOMs under a trivial initialize loop.
    const api = new PaperlessAPI("http://127.0.0.1:1/api", "token");
    const httpApp = createHttpApp({
      api,
      publicUrl: undefined,
      maxSessions: 2,
      sessionIdleTimeoutMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    const listener = await new Promise<Server>((resolve) => {
      const s = httpApp.app.listen(0, () => resolve(s));
    });
    const { port } = listener.address() as { port: number };
    const call = makeRequester(`http://127.0.0.1:${port}`);

    try {
      const a = await call(INIT_BODY);
      const b = await call(INIT_BODY);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(httpApp.sessionCount(), 2);

      const refused = await call(INIT_BODY);
      assert.equal(refused.status, 503);
      assert.match(refused.body, /Too many active sessions/);
      assert.equal(httpApp.sessionCount(), 2, "must not allocate past the cap");

      // Freeing a slot lets a new client in again.
      const del = await call(undefined, a.sessionId!, "DELETE");
      assert.equal(del.status, 200);
      const admitted = await call(INIT_BODY);
      assert.equal(admitted.status, 200);
    } finally {
      await httpApp.shutdown();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });
});
