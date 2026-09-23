import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerDocumentVersionTools } from "./documentVersions";
import { createMockApi, createMockServer, getTextContent } from "./test-helpers";

describe("upload_document_version", () => {
  test("uploads the decoded bytes with the label and returns the task id", async () => {
    let captured: { id: number; bytes: string; filename: string; label?: string } | undefined;
    const api = createMockApi({
      uploadDocumentVersion: async (id: number, document: Buffer, filename: string, label?: string) => {
        captured = { id, bytes: document.toString(), filename, label };
        return '"task-123"';
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentVersionTools(server, api);

    const result = await tools.get("upload_document_version")!.callback({
      id: 9,
      file: Buffer.from("pdf-bytes").toString("base64"),
      filename: "signed.pdf",
      version_label: "signed",
    });

    assert.deepEqual(captured, { id: 9, bytes: "pdf-bytes", filename: "signed.pdf", label: "signed" });
    assert.deepEqual(getTextContent(result), { task_id: "task-123" });
  });

  test("rejects invalid base64 and unreadable paths without calling the API", async () => {
    let called = false;
    const api = createMockApi({
      uploadDocumentVersion: async () => {
        called = true;
        return "x";
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentVersionTools(server, api);
    const tool = tools.get("upload_document_version")!;

    await assert.rejects(() => tool.callback({ id: 1, file: "not base64!", filename: "a.pdf" }), /valid base64/);
    await assert.rejects(
      () => tool.callback({ id: 1, file: "/definitely/not/here.pdf", filename: "a.pdf" }),
      /same machine/
    );
    assert.equal(called, false);
  });
});

describe("merge_documents_as_versions", () => {
  test("requires confirm and sends the root inside `documents`", async () => {
    let body: unknown;
    const api = createMockApi({
      request: async (_path: string, init: { body: string }) => {
        body = JSON.parse(init.body);
        return { result: "OK" };
      },
    });
    const { server, tools } = createMockServer();
    registerDocumentVersionTools(server, api);
    const tool = tools.get("merge_documents_as_versions")!;

    await assert.rejects(() => tool.callback({ root_document_id: 1, merge_documents: [2], confirm: false }), /Confirmation required/);
    await tool.callback({ root_document_id: 1, merge_documents: [2, 1, 3], version_label: "scan", confirm: true });

    assert.deepEqual(body, { root_document_id: 1, documents: [1, 2, 3], version_label: "scan" });
  });
});

describe("delete_document_version", () => {
  test("requires confirm", async () => {
    const { server, tools } = createMockServer();
    registerDocumentVersionTools(server, createMockApi({}));

    await assert.rejects(
      () => tools.get("delete_document_version")!.callback({ id: 1, version_id: 2, confirm: false }),
      /Confirmation required/
    );
  });
});
