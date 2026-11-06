#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "node:util";
import { PaperlessAPI } from "./api/PaperlessAPI";
import { createHttpApp } from "./httpApp";
import { createServer } from "./server";
import { parseUploadDirs } from "./tools/utils/fileInput";

const {
  values: {
    baseUrl,
    token,
    http: useHttp,
    port,
    publicUrl,
    maxSessions,
    sessionIdleMinutes,
    uploadDirs,
  },
} = parseArgs({
  options: {
    baseUrl: { type: "string" },
    token: { type: "string" },
    http: { type: "boolean", default: false },
    port: { type: "string" },
    publicUrl: { type: "string", default: "" },
    maxSessions: { type: "string" },
    sessionIdleMinutes: { type: "string" },
    uploadDirs: { type: "string" },
  },
  allowPositionals: true,
});

const resolvedBaseUrl = baseUrl || process.env.PAPERLESS_URL;
const resolvedToken = token || process.env.PAPERLESS_API_KEY;
const resolvedPublicUrl =
  publicUrl || process.env.PAPERLESS_PUBLIC_URL || resolvedBaseUrl;
// Unset keeps the old behaviour (any absolute path); `none` turns path reads off.
const resolvedUploadDirs = parseUploadDirs(
  uploadDirs || process.env.PAPERLESS_UPLOAD_DIRS
);
const resolvedPort = port ? parseInt(port, 10) : 3000;

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
    "Usage: paperless-ngx-mcp --baseUrl <url> --token <token> [--http] [--port <port>] [--publicUrl <url>] [--uploadDirs <dirs>|none]"
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
      uploadDirs: resolvedUploadDirs,
      maxSessions: resolvedMaxSessions,
      sessionIdleTimeoutMs: resolvedIdleMinutes
        ? resolvedIdleMinutes * 60 * 1000
        : undefined,
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        void shutdown().finally(() => process.exit(0));
      });
    }
    app.listen(resolvedPort, () => {
      console.log(
        `MCP Streamable HTTP Server listening on port ${resolvedPort}`
      );
    });
  } else {
    const server = createServer(api, resolvedPublicUrl, resolvedUploadDirs);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((e) => console.error(e.message));
