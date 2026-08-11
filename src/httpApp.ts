import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { createServer } from "./server";

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;
/**
 * Each session pins a full McpServer — roughly 3.5 MB once every tool schema is
 * registered — and the HTTP port is unauthenticated. Without a ceiling, a loop
 * of `initialize` posts exhausts the heap in seconds. Deliberately conservative;
 * raise it with --maxSessions if you genuinely serve more concurrent clients.
 */
const DEFAULT_MAX_SESSIONS = 50;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeenMs: number;
  /**
   * Requests currently being served for this session, including held-open
   * `GET /mcp` streams. A session is never idle while this is above zero.
   */
  inFlight: number;
}

export interface HttpAppOptions {
  api: PaperlessAPI;
  publicUrl: string | undefined;
  /** Evict sessions untouched for this long. Defaults to 30 minutes. */
  sessionIdleTimeoutMs?: number;
  /** How often to look for idle sessions. Defaults to 60 seconds. */
  sweepIntervalMs?: number;
  /** Reject new sessions past this many live ones. Defaults to 50. */
  maxSessions?: number;
}

export interface HttpApp {
  app: express.Express;
  /** Number of live sessions, streamable-HTTP and SSE combined. Exposed for tests. */
  sessionCount: () => number;
  /** Evict sessions idle past the timeout. Called on a timer; exposed for tests. */
  sweepIdleSessions: () => number;
  /** Stop the sweeper and tear down every session. */
  shutdown: () => Promise<void>;
}

const jsonRpcError = (
  res: express.Response,
  status: number,
  code: number,
  message: string
) => {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
};

export function createHttpApp({
  api,
  publicUrl,
  sessionIdleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
}: HttpAppOptions): HttpApp {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const sessions = new Map<string, Session>();
  const sseTransports: Record<string, SSEServerTransport> = {};
  const sseServers: Record<string, McpServer> = {};

  /**
   * `/mcp` sessions and `/sse` connections each pin their own McpServer, so
   * both draw from the same budget — otherwise the cap on one is just a
   * detour around it via the other.
   */
  const totalSessionCount = () =>
    sessions.size + Object.keys(sseTransports).length;

  const dropSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    // Delete first: closing the server re-enters this via transport.onclose.
    sessions.delete(sessionId);
    void session.server.close().catch(() => {});
  };

  /**
   * Marks the session busy for the duration of `handle`, so a long call or a
   * held-open stream cannot be swept out from under a connected client.
   */
  const serveSession = async (session: Session, handle: () => Promise<void>) => {
    session.inFlight += 1;
    session.lastSeenMs = Date.now();
    try {
      await handle();
    } finally {
      session.inFlight -= 1;
      session.lastSeenMs = Date.now();
    }
  };

  const sweepIdleSessions = () => {
    const cutoff = Date.now() - sessionIdleTimeoutMs;
    let evicted = 0;
    for (const [sessionId, session] of sessions) {
      if (session.inFlight > 0) continue;
      if (session.lastSeenMs > cutoff) continue;
      evicted += 1;
      // Closing the transport fires onclose, which calls dropSession.
      void session.transport.close().catch(() => {});
      dropSession(sessionId);
    }
    return evicted;
  };

  const sweeper = setInterval(sweepIdleSessions, sweepIntervalMs);
  // Never let the sweeper hold the process open.
  sweeper.unref?.();

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          jsonRpcError(res, 404, -32001, "Session not found");
          return;
        }
        await serveSession(session, () =>
          session.transport.handleRequest(req, res, req.body)
        );
        return;
      }

      if (!isInitializeRequest(req.body)) {
        jsonRpcError(
          res,
          400,
          -32000,
          "Bad Request: No valid session ID provided"
        );
        return;
      }

      // Reclaim what we can before refusing work.
      if (totalSessionCount() >= maxSessions) sweepIdleSessions();
      if (totalSessionCount() >= maxSessions) {
        jsonRpcError(
          res,
          503,
          -32000,
          `Too many active sessions (${maxSessions}). Terminate an existing session with DELETE /mcp and retry.`
        );
        return;
      }

      // A fresh server per session: one McpServer cannot serve two transports.
      const server = createServer(api, publicUrl);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          sessions.set(newSessionId, {
            transport,
            server,
            lastSeenMs: Date.now(),
            inFlight: 0,
          });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) dropSession(transport.sessionId);
      };

      await server.connect(transport);
      try {
        await transport.handleRequest(req, res, req.body);
      } finally {
        // If the transport rejected the request before assigning a session id,
        // nothing retains this server — close it rather than leaving it to GC.
        if (!transport.sessionId) await server.close().catch(() => {});
      }
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  const handleSessionRequest = async (
    req: express.Request,
    res: express.Response
  ) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      jsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id required");
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      jsonRpcError(res, 404, -32001, "Session not found");
      return;
    }
    try {
      await serveSession(session, () =>
        session.transport.handleRequest(req, res)
      );
    } catch (error) {
      console.error("Error handling MCP session request:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  };

  app.route("/mcp").get(handleSessionRequest).delete(handleSessionRequest);

  app.get("/sse", async (req, res) => {
    try {
      // Same budget as /mcp: each SSE connection pins its own McpServer too,
      // and this endpoint has no auth either.
      if (totalSessionCount() >= maxSessions) sweepIdleSessions();
      if (totalSessionCount() >= maxSessions) {
        res
          .status(503)
          .send(
            `Too many active sessions (${maxSessions}). Terminate an existing session and retry.`
          );
        return;
      }

      const transport = new SSEServerTransport("/messages", res);
      // Same rule as above: each SSE connection needs its own server.
      const server = createServer(api, publicUrl);
      sseTransports[transport.sessionId] = transport;
      sseServers[transport.sessionId] = server;
      res.on("close", () => {
        delete sseTransports[transport.sessionId];
        delete sseServers[transport.sessionId];
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      });
      await server.connect(transport);
    } catch (error) {
      console.error("Error handling SSE request:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });

  const shutdown = async () => {
    clearInterval(sweeper);
    for (const [sessionId, session] of sessions) {
      await session.transport.close().catch(() => {});
      dropSession(sessionId);
    }
    // Entries can disappear mid-loop as clients disconnect, hence the ?. below.
    for (const sessionId of Object.keys(sseTransports)) {
      await sseTransports[sessionId]?.close().catch(() => {});
      await sseServers[sessionId]?.close().catch(() => {});
      delete sseTransports[sessionId];
      delete sseServers[sessionId];
    }
  };

  return {
    app,
    sessionCount: totalSessionCount,
    sweepIdleSessions,
    shutdown,
  };
}
