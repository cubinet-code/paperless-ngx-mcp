import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "./paginate";

describe("fetchAllPages", () => {
  test("returns all results across multiple pages until next is null", async () => {
    const calls: string[] = [];
    const fetcher = async (qs: string) => {
      calls.push(qs);
      const params = new URLSearchParams(qs);
      const page = Number(params.get("page"));
      if (page === 1) {
        return {
          count: 5,
          next: "/api/tags/?page=2&page_size=100",
          previous: null,
          results: [{ id: 1 }, { id: 2 }, { id: 3 }],
        };
      }
      return {
        count: 5,
        next: null,
        previous: "/api/tags/?page=1&page_size=100",
        results: [{ id: 4 }, { id: 5 }],
      };
    };

    const all = await fetchAllPages(fetcher, { name__icontains: "x" });

    assert.deepEqual(
      all.map((t) => t.id),
      [1, 2, 3, 4, 5]
    );
    assert.equal(calls.length, 2);
    assert.match(calls[0], /name__icontains=x/);
    assert.match(calls[0], /page=1/);
    assert.match(calls[0], /page_size=100/);
    assert.match(calls[1], /page=2/);
  });

  test("strips user-supplied page and page_size to control pagination itself", async () => {
    const seen: string[] = [];
    const fetcher = async (qs: string) => {
      seen.push(qs);
      return { count: 0, next: null, previous: null, results: [] };
    };
    await fetchAllPages(fetcher, { page: 99, page_size: 7, ordering: "name" });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /page_size=100/);
    assert.match(seen[0], /ordering=name/);
    assert.doesNotMatch(seen[0], /page_size=7/);
    assert.doesNotMatch(seen[0], /page=99/);
  });

  test("stops on a single page when next is null immediately", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return {
        count: 2,
        next: null,
        previous: null,
        results: [{ id: 1 }, { id: 2 }],
      };
    };
    const all = await fetchAllPages(fetcher);
    assert.equal(calls, 1);
    assert.equal(all.length, 2);
  });
});
