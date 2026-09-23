import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { buildMinimalPdf, eventually, seedDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

interface Version {
  id: number;
  is_root: boolean;
  version_label: string | null;
}

describe("document versions (e2e)", () => {
  let harness: E2EHarness;
  let token: string;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  const versionsOf = async (id: number) =>
    (await harness.callTool<{ versions: Version[] }>("get_document", { id })).versions;

  test("upload, relabel and delete a version; the root can't be deleted", async () => {
    const { id } = await seedDocument(token, "versions-e2e");

    const upload = await harness.callTool<{ status: string }>("upload_document_version", {
      id,
      file: buildMinimalPdf(`versions-e2e-v2-${Date.now()}`).toString("base64"),
      filename: "v2.pdf",
      version_label: "v2",
      poll: true,
      poll_timeout_seconds: 120,
    });
    assert.equal(upload.status, "success");

    const versions = await versionsOf(id);
    assert.equal(versions.length, 2);
    const added = versions.find((v) => !v.is_root)!;
    const root = versions.find((v) => v.is_root)!;
    assert.equal(added.version_label, "v2");

    const relabeled = await harness.callTool<Version>("update_document_version", {
      id,
      version_id: added.id,
      version_label: "signed",
    });
    assert.equal(relabeled.version_label, "signed");

    await assert.rejects(
      () => harness.callTool("delete_document_version", { id, version_id: root.id, confirm: true }),
      /root/i
    );

    await harness.callTool("delete_document_version", { id, version_id: added.id, confirm: true });
    assert.equal((await versionsOf(id)).length, 1);
  });

  test("merge_documents_as_versions folds a document into another", async () => {
    const [{ id: root }, { id: other }] = await Promise.all([
      seedDocument(token, "merge-root"),
      seedDocument(token, "merge-other"),
    ]);

    await harness.callTool("merge_documents_as_versions", {
      root_document_id: root,
      merge_documents: [other],
      version_label: "merged",
      confirm: true,
    });

    const versions = await eventually(async () => {
      const v = await versionsOf(root);
      return v.length === 2 ? v : undefined;
    }, 60_000);
    assert.equal(versions.find((v) => !v.is_root)?.version_label, "merged");
    const standalone = await axios.get(`${BASE_URL}/api/documents/${other}/`, {
      headers: { Authorization: `Token ${token}` },
      validateStatus: () => true,
    });
    assert.equal(standalone.status, 404);
  });
});
