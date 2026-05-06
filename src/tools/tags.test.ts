import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerTagTools } from "./tags";
import { createMockServer, createMockApi, getTextContent } from "./test-helpers";

describe("list_tags tool", () => {
  test("paginates across all pages when is_empty is set and returns only matches", async () => {
    const calls: string[] = [];
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getTags: async (qs: string) => {
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
              { id: 1, name: "A", document_count: 5, matching_algorithm: 0 },
            ],
          };
        }
        return {
          count: 3,
          next: null,
          previous: "prev",
          all: [1, 2, 3],
          results: [
            { id: 2, name: "B", document_count: 0, matching_algorithm: 0 },
            { id: 3, name: "C", document_count: 4, matching_algorithm: 0 },
          ],
        };
      },
    });
    registerTagTools(server, api);

    const tool = tools.get("list_tags")!;
    const result = await tool.callback({ is_empty: true });
    const body = getTextContent(result) as {
      count: number;
      next: null;
      all: number[];
      results: Array<{ id: number; document_count: number }>;
    };

    assert.equal(calls.length, 2);
    assert.equal(body.count, 1);
    assert.equal(body.next, null);
    assert.deepEqual(body.all, [2]);
    assert.equal(body.results[0].id, 2);
  });

  test("without is_empty uses single-page server response unchanged", async () => {
    let getTagsCalls = 0;
    const { server, tools } = createMockServer();
    const api = createMockApi({
      getTags: async () => {
        getTagsCalls += 1;
        return {
          count: 50,
          next: "n",
          previous: null,
          all: Array.from({ length: 50 }, (_, i) => i + 1),
          results: [{ id: 1, name: "A", document_count: 5, matching_algorithm: 0 }],
        };
      },
    });
    registerTagTools(server, api);

    const tool = tools.get("list_tags")!;
    const result = await tool.callback({});
    const body = getTextContent(result) as {
      count: number;
      next: string;
      all: number[];
      results: unknown[];
    };

    assert.equal(getTagsCalls, 1);
    assert.equal(body.count, 50);
    assert.equal(body.all.length, 50);
    assert.equal(body.next, "n");
  });
});
