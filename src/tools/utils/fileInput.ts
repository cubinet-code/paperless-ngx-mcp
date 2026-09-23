import fs from "node:fs/promises";
import path from "node:path";

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

function isLikelyBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_REGEX.test(value);
}

export const FILE_INPUT_DESCRIPTION =
  "Base64-encoded file content (the universal method — works for any deployment, since the bytes travel over the wire). Alternatively, an absolute file path (e.g. /tmp/invoice.pdf) that the server reads from its OWN filesystem — this only works when the server runs on the same machine as the file (local/stdio deployments). For a remote server, the path option will fail; use base64 instead.";

/** Resolves a tool's `file` argument — base64 content or a server-local absolute path — to bytes. */
export async function readFileInput(file: string): Promise<Buffer> {
  if (path.isAbsolute(file)) {
    try {
      return await fs.readFile(file);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not read '${file}' from the server's filesystem (${reason}). ` +
          "The absolute-path option only works when this MCP server runs on the same machine as the file. " +
          "If the server is remote, pass the file as base64-encoded content instead."
      );
    }
  }
  if (!isLikelyBase64(file)) {
    throw new Error(
      "Invalid input: provide a valid base64 string or an absolute file path."
    );
  }
  return Buffer.from(file, "base64");
}
