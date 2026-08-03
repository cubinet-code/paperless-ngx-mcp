import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isTerminalTaskStatus,
  relatedDocumentId,
  taskResult,
  taskStatusIs,
} from "./tasks";

describe("isTerminalTaskStatus", () => {
  test("recognises Paperless 2.x uppercase statuses", () => {
    assert.equal(isTerminalTaskStatus("SUCCESS"), true);
    assert.equal(isTerminalTaskStatus("FAILURE"), true);
    assert.equal(isTerminalTaskStatus("REVOKED"), true);
  });

  test("recognises Paperless 3.x lowercase statuses", () => {
    assert.equal(isTerminalTaskStatus("success"), true);
    assert.equal(isTerminalTaskStatus("failure"), true);
    assert.equal(isTerminalTaskStatus("revoked"), true);
  });

  test("treats in-flight and missing statuses as non-terminal", () => {
    assert.equal(isTerminalTaskStatus("STARTED"), false);
    assert.equal(isTerminalTaskStatus("pending"), false);
    assert.equal(isTerminalTaskStatus(undefined), false);
  });
});

describe("taskStatusIs", () => {
  test("compares case-insensitively across both versions", () => {
    assert.equal(taskStatusIs("SUCCESS", "success"), true);
    assert.equal(taskStatusIs("success", "success"), true);
    assert.equal(taskStatusIs("FAILURE", "success"), false);
    assert.equal(taskStatusIs(undefined, "success"), false);
  });
});

describe("relatedDocumentId", () => {
  test("reads related_document (Paperless 2.x)", () => {
    assert.equal(relatedDocumentId({ related_document: 42 }), 42);
    assert.equal(relatedDocumentId({ related_document: "42" }), 42);
  });

  test("reads related_document_ids (Paperless 3.x)", () => {
    assert.equal(relatedDocumentId({ related_document_ids: [42] }), 42);
  });

  test("returns undefined when absent, empty, or unparseable", () => {
    assert.equal(relatedDocumentId({}), undefined);
    assert.equal(relatedDocumentId({ related_document: null }), undefined);
    assert.equal(relatedDocumentId({ related_document_ids: [] }), undefined);
    assert.equal(relatedDocumentId({ related_document: "nope" }), undefined);
  });
});

describe("taskResult", () => {
  test("reads result (2.x) and result_data (3.x)", () => {
    assert.equal(taskResult({ result: "ok" }), "ok");
    assert.equal(taskResult({ result_data: "ok" }), "ok");
    assert.equal(taskResult({}), undefined);
  });
});
