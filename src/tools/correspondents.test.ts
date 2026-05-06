import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerCorrespondentTools } from "./correspondents";
import { createMockServer, createMockApi, getTextContent } from "./test-helpers";

describe("list_correspondents tool", () => {
  test("paginates across all pages when is_empty is set and returns only matches", async () => {
    const calls: string[] = [];
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getCorrespondents: async (qs: string) => {
        calls.push(qs);
        const params = new URLSearchParams(qs);
        const page = Number(params.get("page"));
        if (page === 1) {
          return {
            count: 4,
            next: "next-url",
            previous: null,
            all: [1, 2, 3, 4],
            results: [
              { id: 1, name: "A", document_count: 5, matching_algorithm: 0 },
              { id: 2, name: "B", document_count: 0, matching_algorithm: 0 },
            ],
          };
        }
        return {
          count: 4,
          next: null,
          previous: "prev",
          all: [1, 2, 3, 4],
          results: [
            { id: 3, name: "C", document_count: 0, matching_algorithm: 0 },
            { id: 4, name: "D", document_count: 7, matching_algorithm: 0 },
          ],
        };
      },
    });
    registerCorrespondentTools(server, api);

    const tool = tools.get("list_correspondents")!;
    const result = await tool.callback({ is_empty: true });
    const body = getTextContent(result) as {
      count: number;
      next: null;
      previous: null;
      all: number[];
      results: Array<{ id: number; document_count: number }>;
    };

    assert.equal(calls.length, 2);
    assert.equal(body.count, 2);
    assert.equal(body.next, null);
    assert.equal(body.previous, null);
    assert.deepEqual(body.all, [2, 3]);
    assert.equal(body.results.length, 2);
    assert.ok(body.results.every((c) => c.document_count === 0));
  });

  test("is_empty: false returns only correspondents with documents (paginated)", async () => {
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getCorrespondents: async () => ({
        count: 3,
        next: null,
        previous: null,
        all: [1, 2, 3],
        results: [
          { id: 1, name: "A", document_count: 5, matching_algorithm: 0 },
          { id: 2, name: "B", document_count: 0, matching_algorithm: 0 },
          { id: 3, name: "C", document_count: 2, matching_algorithm: 0 },
        ],
      }),
    });
    registerCorrespondentTools(server, api);

    const tool = tools.get("list_correspondents")!;
    const result = await tool.callback({ is_empty: false });
    const body = getTextContent(result) as { count: number; results: Array<{ id: number }> };

    assert.equal(body.count, 2);
    assert.deepEqual(body.results.map((c) => c.id), [1, 3]);
  });

  test("without is_empty preserves the server's pagination shape (single-page behaviour unchanged)", async () => {
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getCorrespondents: async () => ({
        count: 130,
        next: "next-url",
        previous: null,
        all: Array.from({ length: 130 }, (_, i) => i + 1),
        results: [
          { id: 1, name: "A", document_count: 5, matching_algorithm: 0 },
        ],
      }),
    });
    registerCorrespondentTools(server, api);

    const tool = tools.get("list_correspondents")!;
    const result = await tool.callback({ page: 1, page_size: 25 });
    const body = getTextContent(result) as {
      count: number;
      next: string;
      all: number[];
      results: unknown[];
    };

    assert.equal(body.count, 130);
    assert.equal(body.next, "next-url");
    assert.equal(body.all.length, 130);
    assert.equal(body.results.length, 1);
  });
});
