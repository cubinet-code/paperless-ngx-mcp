import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseUploadDirs, readFileInput } from "./fileInput";

describe("parseUploadDirs", () => {
  test("unset or blank means unrestricted", () => {
    assert.equal(parseUploadDirs(undefined), undefined);
    assert.equal(parseUploadDirs(""), undefined);
    assert.equal(parseUploadDirs("   "), undefined);
  });

  test("none (any case) disables path reads", () => {
    assert.deepEqual(parseUploadDirs("none"), []);
    assert.deepEqual(parseUploadDirs(" NONE "), []);
  });

  test("splits on the platform delimiter and resolves each directory", () => {
    const a = path.resolve("/scans");
    const b = path.resolve("/inbox");
    assert.deepEqual(parseUploadDirs(`${a}${path.delimiter} ${b} ${path.delimiter}`), [a, b]);
  });
});

describe("readFileInput with upload directories", () => {
  let root: string;
  let allowed: string;
  let outside: string;
  let insideFile: string;
  let outsideFile: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pnm-upload-"));
    allowed = path.join(root, "allowed");
    outside = path.join(root, "outside");
    await fs.mkdir(allowed);
    await fs.mkdir(outside);
    insideFile = path.join(allowed, "invoice.pdf");
    outsideFile = path.join(outside, "id_rsa");
    await fs.writeFile(insideFile, "inside-bytes");
    await fs.writeFile(outsideFile, "secret-bytes");
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test("reads a file inside an allowed directory", async () => {
    const bytes = await readFileInput(insideFile, [allowed]);
    assert.equal(bytes.toString(), "inside-bytes");
  });

  test("matches the allowed directory case-insensitively on Windows", { skip: process.platform !== "win32" }, async () => {
    const bytes = await readFileInput(insideFile, [allowed.toUpperCase()]);
    assert.equal(bytes.toString(), "inside-bytes");
  });

  test("refuses a file outside every allowed directory", async () => {
    await assert.rejects(() => readFileInput(outsideFile, [allowed]), /base64/);
  });

  test("refuses `..` traversal out of an allowed directory", async () => {
    const traversal = `${allowed}${path.sep}..${path.sep}outside${path.sep}id_rsa`;
    await assert.rejects(() => readFileInput(traversal, [allowed]), /not a readable file inside/);
  });

  test("refuses a sibling directory that merely shares the prefix", async () => {
    const sibling = `${allowed}-evil`;
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, "x.pdf"), "x");
    await assert.rejects(() => readFileInput(path.join(sibling, "x.pdf"), [allowed]), /not a readable file inside/);
  });

  test("refuses a symlink inside an allowed directory that points outside it", async (t) => {
    const link = path.join(allowed, "escape.pdf");
    try {
      await fs.symlink(outsideFile, link);
    } catch {
      // Windows needs Developer Mode or admin rights to create symlinks.
      t.skip("symlink creation not permitted");
      return;
    }
    await assert.rejects(() => readFileInput(link, [allowed]), /not a readable file inside/);
  });

  test("gives the same error for a missing file as for one outside", async () => {
    await assert.rejects(
      () => readFileInput(path.join(outside, "missing.pdf"), [allowed]),
      /not a readable file inside/
    );
  });

  test("an empty list disables path reads entirely", async () => {
    await assert.rejects(() => readFileInput(insideFile, []), /disabled on this server/);
  });

  test("base64 still works when path reads are restricted or disabled", async () => {
    const encoded = Buffer.from("pdf-bytes").toString("base64");
    assert.equal((await readFileInput(encoded, [allowed])).toString(), "pdf-bytes");
    assert.equal((await readFileInput(encoded, [])).toString(), "pdf-bytes");
  });

  test("without a list, any absolute path is read as before", async () => {
    const bytes = await readFileInput(outsideFile);
    assert.equal(bytes.toString(), "secret-bytes");
  });
});
