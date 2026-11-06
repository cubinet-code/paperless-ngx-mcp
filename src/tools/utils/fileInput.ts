import fs from "node:fs/promises";
import path from "node:path";

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

function isLikelyBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_REGEX.test(value);
}

export const FILE_INPUT_DESCRIPTION =
  "Base64-encoded file content (the universal method — works for any deployment, since the bytes travel over the wire). Alternatively, an absolute file path (e.g. /tmp/invoice.pdf) that the server reads from its OWN filesystem — this only works when the server runs on the same machine as the file (local/stdio deployments), and the server may limit it to configured upload directories or turn it off. If the path option fails, use base64 instead.";

/**
 * Which server-local paths a `file` argument may name.
 * `undefined` — any absolute path (the default, kept for backward compatibility).
 * `[]` — none: path reads are disabled and only base64 is accepted.
 * Otherwise — only files inside one of these absolute directories.
 */
export type UploadDirs = readonly string[] | undefined;

/**
 * Parses PAPERLESS_UPLOAD_DIRS / --uploadDirs: directories separated by the
 * platform's path delimiter (`:` on POSIX, `;` on Windows), or `none` to turn
 * path reads off. Unset or blank means unrestricted.
 */
export function parseUploadDirs(value: string | undefined): UploadDirs {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "none") return [];
  const dirs = trimmed
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0)
    .map((dir) => path.resolve(dir));
  return dirs.length > 0 ? dirs : undefined;
}

// Windows paths are case-insensitive; compare them folded so C:\Scans and c:\scans match.
const normalizeForCompare = (p: string) =>
  process.platform === "win32" ? p.toLowerCase() : p;

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(normalizeForCompare(dir), normalizeForCompare(file));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Returns the real path of `file` if it lies inside one of `allowedDirs`, else
 * null. Both sides go through realpath, so `..` segments and symlinks pointing
 * out of an allowed directory are judged by where they really lead.
 */
async function resolveAllowedPath(
  file: string,
  allowedDirs: readonly string[]
): Promise<string | null> {
  let realFile: string;
  try {
    realFile = await fs.realpath(file);
  } catch {
    return null;
  }
  for (const dir of allowedDirs) {
    let realDir: string;
    try {
      realDir = await fs.realpath(dir);
    } catch {
      continue; // A configured directory that doesn't exist allows nothing.
    }
    if (isInside(realFile, realDir)) return realFile;
  }
  return null;
}

/** Resolves a tool's `file` argument — base64 content or a server-local absolute path — to bytes. */
export async function readFileInput(
  file: string,
  allowedDirs?: UploadDirs
): Promise<Buffer> {
  if (path.isAbsolute(file)) {
    let target = file;
    if (allowedDirs) {
      if (allowedDirs.length === 0) {
        throw new Error(
          "Reading files from the server's filesystem is disabled on this server (PAPERLESS_UPLOAD_DIRS=none). " +
            "Pass the file as base64-encoded content instead."
        );
      }
      const allowed = await resolveAllowedPath(file, allowedDirs);
      // One message for "missing" and "outside" so the error can't be used to probe for files.
      if (!allowed) {
        throw new Error(
          `'${file}' is not a readable file inside the directories this server may upload from (${allowedDirs.join(path.delimiter)}). ` +
            "Pass the file as base64-encoded content instead, or ask the user to move it into one of those directories."
        );
      }
      // Read the resolved path rather than the original, so the bytes come from the location that was checked.
      target = allowed;
    }
    try {
      return await fs.readFile(target);
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
