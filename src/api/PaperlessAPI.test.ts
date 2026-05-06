import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { PaperlessAPI, client } from "./PaperlessAPI";

describe("PaperlessAPI", () => {
  describe("error handling against a non-existent server", () => {
    // Regression: the catch block must not produce "(HTTP undefined)" when
    // there is no response object (connection refused, DNS failure, etc.).
    const api = new PaperlessAPI("http://localhost:8000", "test-token");

    test("request surfaces connection errors without 'HTTP undefined'", async () => {
      await assert.rejects(
        () => api.request("/test/"),
        (err: Error) => {
          assert.ok(!err.message.includes("HTTP undefined"));
          return true;
        }
      );
    });

    test("requestRaw surfaces connection errors without 'HTTP undefined'", async () => {
      await assert.rejects(
        () => api.requestRaw("/test/"),
        (err: Error) => {
          assert.ok(!err.message.includes("HTTP undefined"));
          return true;
        }
      );
    });
  });

  describe("HTTP client timeout and keep-alive (regression)", () => {
    // Regression: without a request timeout, a TCP connection silently dropped
    // by an upstream proxy after idle would leave axios waiting forever — the
    // MCP client would only give up at 4 min. Verify the production defaults
    // are set, and that the timeout mechanism actually fires against a server
    // that accepts connections but never writes a response.

    let hangServer: Server;
    let port: number;
    const sockets: Socket[] = [];

    before(async () => {
      hangServer = createServer((socket) => {
        // Accept the TCP connection but never respond.
        sockets.push(socket);
      });
      await new Promise<void>((resolve) =>
        hangServer.listen(0, "127.0.0.1", resolve)
      );
      port = (hangServer.address() as { port: number }).port;
    });

    after(async () => {
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => hangServer.close(() => resolve()));
    });

    test("client defaults pin a request timeout and keep-alive agents", () => {
      assert.equal(client.defaults.timeout, 60_000);

      const httpAgent = client.defaults.httpAgent as HttpAgent;
      assert.equal(httpAgent.keepAlive, true);
      assert.equal(
        (httpAgent.options as { timeout?: number }).timeout,
        30_000
      );

      const httpsAgent = client.defaults.httpsAgent as HttpsAgent;
      assert.equal(httpsAgent.keepAlive, true);
      assert.equal(
        (httpsAgent.options as { timeout?: number }).timeout,
        30_000
      );
    });

    test("request rejects fast when upstream accepts but never responds", async () => {
      const originalTimeout = client.defaults.timeout;
      client.defaults.timeout = 200;
      try {
        const api = new PaperlessAPI(
          `http://127.0.0.1:${port}`,
          "test-token"
        );
        const start = Date.now();
        await assert.rejects(
          () => api.request("/test/"),
          (err: Error) => {
            assert.match(err.message, /timeout/i);
            return true;
          }
        );
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 2000, `expected <2s, took ${elapsed}ms`);
      } finally {
        client.defaults.timeout = originalTimeout;
      }
    });
  });
});
