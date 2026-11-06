#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "node:util";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { createHttpApp, DEFAULT_HTTP_HOST } from "./httpApp";
import { createServer } from "./server";

const {
  values: {
    baseUrl,
    token,
    http: useHttp,
    port,
    host,
    publicUrl,
    maxSessions,
    sessionIdleMinutes,
  },
} = parseArgs({
  options: {
    baseUrl: { type: "string" },
    token: { type: "string" },
    http: { type: "boolean", default: false },
    port: { type: "string" },
    host: { type: "string" },
    publicUrl: { type: "string", default: "" },
    maxSessions: { type: "string" },
    sessionIdleMinutes: { type: "string" },
  },
  allowPositionals: true,
});

const resolvedBaseUrl = baseUrl || process.env.PAPERLESS_URL;
const resolvedToken = token || process.env.PAPERLESS_API_KEY;
const resolvedPublicUrl =
  publicUrl || process.env.PAPERLESS_PUBLIC_URL || resolvedBaseUrl;
const resolvedPort = port ? parseInt(port, 10) : 3000;
// Loopback by default: the HTTP transport has no authentication.
const resolvedHost =
  host?.trim() || process.env.PAPERLESS_MCP_HOST?.trim() || DEFAULT_HTTP_HOST;

const positiveNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const resolvedMaxSessions = positiveNumber(
  maxSessions || process.env.PAPERLESS_MAX_SESSIONS
);
const resolvedIdleMinutes = positiveNumber(
  sessionIdleMinutes || process.env.PAPERLESS_SESSION_IDLE_MINUTES
);

if (!resolvedBaseUrl || !resolvedToken) {
  console.error(
    "Usage: paperless-ngx-mcp --baseUrl <url> --token <token> [--http] [--port <port>] [--host <address>] [--publicUrl <url>]"
  );
  console.error(
    "Or set PAPERLESS_URL and PAPERLESS_API_KEY environment variables."
  );
  process.exit(1);
}

async function main() {
  const api = new PaperlessAPI(resolvedBaseUrl!, resolvedToken!);

  if (useHttp) {
    const { app, shutdown } = createHttpApp({
      api,
      publicUrl: resolvedPublicUrl,
      maxSessions: resolvedMaxSessions,
      host: resolvedHost,
      sessionIdleTimeoutMs: resolvedIdleMinutes
        ? resolvedIdleMinutes * 60 * 1000
        : undefined,
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        void shutdown().finally(() => process.exit(0));
      });
    }
    const displayHost = resolvedHost.includes(":")
      ? `[${resolvedHost}]`
      : resolvedHost;
    app.listen(resolvedPort, resolvedHost, () => {
      console.log(
        `MCP Streamable HTTP Server listening on http://${displayHost}:${resolvedPort}`
      );
    });
  } else {
    const server = createServer(api, resolvedPublicUrl);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((e) => console.error(e.message));
