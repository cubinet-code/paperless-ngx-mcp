import { before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { buildMinimalPdf } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

interface PostDocumentPollResult {
  status: string;
  task_id?: string;
  document_id?: number;
  result?: unknown;
  timed_out?: boolean;
}

describe("post_document — poll round-trip", () => {
  let harness: E2EHarness;

  before(async () => {
    const { token } = await seed();
    harness = createHarness(BASE_URL, token);
  });

  test("poll=true uploads base64 content and returns SUCCESS with the new document_id", async () => {
    const title = `post-doc-poll-e2e-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const file = buildMinimalPdf(title).toString("base64");

    const result = await harness.callTool<PostDocumentPollResult>(
      "post_document",
      {
        file,
        filename: `${title}.pdf`,
        title,
        poll: true,
        poll_timeout_seconds: 180,
      }
    );

    assert.equal(
      result.status,
      "SUCCESS",
      `expected the consumer to finish SUCCESS, got ${JSON.stringify(result)}`
    );
    assert.ok(
      typeof result.document_id === "number" && result.document_id > 0,
      `expected a numeric document_id, got ${JSON.stringify(result)}`
    );
  });
});
