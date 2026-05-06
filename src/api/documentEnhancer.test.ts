import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { convertDocsWithNames } from "./documentEnhancer";
import { Document } from "./types";
import { PaperlessAPI } from "./PaperlessAPI";

/** Minimal document stub with only the fields the enhancer reads. */
function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 1,
    correspondent: null,
    document_type: null,
    storage_path: null,
    title: "Test",
    content: null,
    tags: [],
    created: "",
    created_date: "",
    modified: "",
    added: "",
    deleted_at: null,
    archive_serial_number: null,
    original_file_name: "",
    archived_file_name: "",
    owner: null,
    user_can_change: true,
    is_shared_by_requester: false,
    notes: [],
    custom_fields: [],
    page_count: 1,
    mime_type: "application/pdf",
    ...overrides,
  };
}

interface ApiCalls {
  getCorrespondents?: string;
  getDocumentTypes?: string;
  getTags?: string;
  getCustomFields?: string;
}

/**
 * Mock API that records the query string passed to each list method and
 * returns a configurable set of named entities.
 */
function spyApi(calls: ApiCalls, entities: { ids: number[] }): PaperlessAPI {
  const items = (prefix: string) =>
    entities.ids.map((id) => ({
      id,
      name: `${prefix} ${id}`,
      // unused fields below — proxy doesn't care about exact shape
    }));

  const paginate = (results: unknown[]) => ({
    count: results.length,
    next: null,
    previous: null,
    all: (results as { id: number }[]).map((r) => r.id),
    results,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler: ProxyHandler<any> = {
    get(_target, prop: string) {
      if (prop === "getCorrespondents")
        return async (q: string) => {
          calls.getCorrespondents = q;
          return paginate(items("Correspondent"));
        };
      if (prop === "getDocumentTypes")
        return async (q: string) => {
          calls.getDocumentTypes = q;
          return paginate(items("DocType"));
        };
      if (prop === "getTags")
        return async (q: string) => {
          calls.getTags = q;
          return paginate(items("Tag"));
        };
      if (prop === "getCustomFields")
        return async (q: string) => {
          calls.getCustomFields = q;
          return paginate(items("Field"));
        };
      return () => {
        throw new Error(`Unmocked: ${prop}`);
      };
    },
  };
  return new Proxy({} as PaperlessAPI, handler);
}

describe("documentEnhancer", () => {
  test("requests page_size=10000 for every lookup endpoint and resolves IDs to names", async () => {
    // Regression: the enhancer must request a large page so it can resolve
    // IDs that fall beyond the API's default page size (~25). Without this,
    // names silently fall back to numeric strings.
    const calls: ApiCalls = {};
    const api = spyApi(calls, { ids: [3, 40, 50, 65, 99] });

    const doc = makeDocument({
      correspondent: 65,
      document_type: 40,
      tags: [3, 50],
      custom_fields: [{ field: 99, value: "test" }],
    });

    const result = await convertDocsWithNames(doc, api);
    const parsed = JSON.parse(
      result.content.find((c) => c.type === "text" && "text" in c)!.text!
    );

    assert.equal(calls.getCorrespondents, "page_size=10000");
    assert.equal(calls.getDocumentTypes, "page_size=10000");
    assert.equal(calls.getTags, "page_size=10000");
    assert.equal(calls.getCustomFields, "page_size=10000");

    assert.deepEqual(parsed.correspondent, { id: 65, name: "Correspondent 65" });
    assert.deepEqual(parsed.document_type, { id: 40, name: "DocType 40" });
    assert.deepEqual(parsed.tags[0], { id: 3, name: "Tag 3" });
    assert.deepEqual(parsed.tags[1], { id: 50, name: "Tag 50" });
    assert.deepEqual(parsed.custom_fields[0], {
      field: 99,
      name: "Field 99",
      value: "test",
    });
  });

  test("strips document content from results", async () => {
    // The enhancer must drop `content` (full OCR text) so it never reaches
    // the LLM context — privacy/size concern.
    const api = spyApi({}, { ids: [] });
    const doc = makeDocument({ content: "This is secret content" });

    const result = await convertDocsWithNames(doc, api);
    const parsed = JSON.parse(
      result.content.find((c) => c.type === "text" && "text" in c)!.text!
    );

    assert.equal(parsed.content, undefined);
  });
});
