import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerDocumentTypeTools } from "./documentTypes";
import { createMockServer, createMockApi, getTextContent } from "./test-helpers";

describe("list_document_types tool", () => {
  test("paginates across all pages when is_empty is set and returns only matches", async () => {
    const calls: string[] = [];
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getDocumentTypes: async (qs: string) => {
        calls.push(qs);
        const params = new URLSearchParams(qs);
        const page = Number(params.get("page"));
        if (page === 1) {
          return {
            count: 3,
            next: "next-url",
            previous: null,
            all: [1, 2, 3],
            results: [
              { id: 1, name: "Invoice", document_count: 10, matching_algorithm: 0 },
            ],
          };
        }
        return {
          count: 3,
          next: null,
          previous: "prev",
          all: [1, 2, 3],
          results: [
            { id: 2, name: "Receipt", document_count: 0, matching_algorithm: 0 },
            { id: 3, name: "Letter", document_count: 0, matching_algorithm: 0 },
          ],
        };
      },
    });
    registerDocumentTypeTools(server, api);

    const tool = tools.get("list_document_types")!;
    const result = await tool.callback({ is_empty: true });
    const body = getTextContent(result) as {
      count: number;
      next: null;
      all: number[];
      results: Array<{ id: number; document_count: number }>;
    };

    assert.equal(calls.length, 2);
    assert.equal(body.count, 2);
    assert.equal(body.next, null);
    assert.deepEqual(body.all, [2, 3]);
    assert.ok(body.results.every((dt) => dt.document_count === 0));
  });

  test("without is_empty preserves the server's pagination shape (single-page behaviour unchanged)", async () => {
    let calls = 0;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getDocumentTypes: async () => {
        calls += 1;
        return {
          count: 25,
          next: "next-url",
          previous: null,
          all: Array.from({ length: 25 }, (_, i) => i + 1),
          results: [
            { id: 1, name: "Invoice", document_count: 10, matching_algorithm: 0 },
          ],
        };
      },
    });
    registerDocumentTypeTools(server, api);

    const tool = tools.get("list_document_types")!;
    const result = await tool.callback({});
    const body = getTextContent(result) as {
      count: number;
      next: string;
      all: number[];
      results: unknown[];
    };

    assert.equal(calls, 1);
    assert.equal(body.count, 25);
    assert.equal(body.all.length, 25);
    assert.equal(body.next, "next-url");
  });
});
