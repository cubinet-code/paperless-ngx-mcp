import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
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

  describe("Accept header (regression for stale API version pin)", () => {
    let httpServer: HttpServer;
    let port: number;
    let lastRequest: IncomingMessage | null = null;

    before(async () => {
      httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        lastRequest = req;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
      await new Promise<void>((resolve) =>
        httpServer.listen(0, "127.0.0.1", resolve)
      );
      port = (httpServer.address() as { port: number }).port;
    });

    after(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    test("does not pin a stale API version (allows server's default)", async () => {
      const api = new PaperlessAPI(`http://127.0.0.1:${port}`, "test-token");
      await api.request("/test/");

      const accept = lastRequest?.headers["accept"] ?? "";
      assert.ok(
        !/version=5\b/.test(accept),
        `Accept header still pins API version=5: ${accept}`
      );
    });
  });

  describe("overall request deadline", () => {
    // A response that keeps trickling bytes never trips the 60s socket-idle
    // timeout, so without a whole-request deadline a call can hang for as long
    // as the MCP client is willing to wait (4 min in the field report).
    let server: HttpServer;
    let port: number;
    const open: ServerResponse[] = [];

    before(async () => {
      server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        open.push(res);
        res.writeHead(200, { "Content-Type": "application/json" });
        const timer = setInterval(() => res.write(" "), 50);
        res.on("close", () => clearInterval(timer));
        if (req.url?.includes("finite")) {
          setTimeout(() => {
            clearInterval(timer);
            res.end("{}");
          }, 600);
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as { port: number }).port;
    });

    after(async () => {
      open.forEach((r) => r.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // node:test timeout so a regression fails the suite instead of hanging it.
    test("request rejects with a clear message once the deadline passes", { timeout: 5000 }, async () => {
      const api = new PaperlessAPI(`http://127.0.0.1:${port}`, "t", 300);
      const start = Date.now();

      await assert.rejects(
        () => api.request("/tags/"),
        (err: Error) => {
          assert.match(err.message, /did not finish responding within 0\.3s \(GET \/tags\/\)/);
          return true;
        }
      );
      assert.ok(Date.now() - start < 2000, "must not wait past the deadline");
    });

    test("a timed-out write warns that it may already have been applied", { timeout: 5000 }, async () => {
      const api = new PaperlessAPI(`http://127.0.0.1:${port}`, "t", 300);

      await assert.rejects(
        () => api.request("/documents/bulk_edit/", { method: "POST", body: "{}" }),
        (err: Error) => {
          assert.match(err.message, /\(POST \/documents\/bulk_edit\/\)/);
          assert.match(err.message, /may already have been applied/);
          assert.doesNotMatch(err.message, /page_size/);
          return true;
        }
      );
    });

    test("requestRaw (downloads) is not bound by the JSON deadline", async () => {
      const api = new PaperlessAPI(`http://127.0.0.1:${port}`, "t", 100);

      const response = await api.requestRaw("/documents/1/download/?finite=1");

      assert.equal(response.status, 200);
    });
  });

  describe("error bodies", () => {
    let server: HttpServer;
    let port: number;

    before(async () => {
      server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, type: string, body: string) => {
          res.writeHead(status, { "Content-Type": type });
          res.end(body);
        };
        if (req.url === "/api/validation/") {
          send(400, "application/json", '{"non_field_errors":["password not specified"]}');
        } else if (req.url === "/api/plain/") {
          send(400, "text/plain", "AI is required for this feature");
        } else if (req.url === "/api/html/") {
          send(500, "text/html", "<!doctype html><title>Server Error (500)</title>");
        } else {
          send(404, "application/json", '{"detail":"No Document matches the given query."}');
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as { port: number }).port;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const messageFor = async (path: string) => {
      const api = new PaperlessAPI(`http://127.0.0.1:${port}`, "t");
      try {
        await api.request(path);
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error("expected a rejection");
    };

    test("DRF validation errors are included", async () => {
      assert.equal(
        await messageFor("/validation/"),
        '{"non_field_errors":["password not specified"]} (HTTP 400)'
      );
    });

    test("plain-text error bodies are included", async () => {
      assert.equal(await messageFor("/plain/"), "AI is required for this feature (HTTP 400)");
    });

    test("HTML error pages are not dumped into the message", async () => {
      assert.equal(await messageFor("/html/"), "Request failed with status code 500 (HTTP 500)");
    });

    test("{detail} errors keep their existing format", async () => {
      assert.equal(await messageFor("/missing/"), "No Document matches the given query. (HTTP 404)");
    });
  });
});
