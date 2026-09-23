import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerShareLinkTools } from "./shareLinks";
import { createMockApi, createMockServer } from "./test-helpers";

describe("share link tools", () => {
  test("update_share_link is gone (Paperless share links cannot be edited)", () => {
    const { server, tools } = createMockServer();
    registerShareLinkTools(server, createMockApi({}));
    assert.equal(tools.has("update_share_link"), false);
  });

  test("delete_share_link_bundle requires confirm", async () => {
    const { server, tools } = createMockServer();
    registerShareLinkTools(server, createMockApi({}));
    await assert.rejects(
      () => tools.get("delete_share_link_bundle")!.callback({ id: 1, confirm: false }),
      /Confirmation required/
    );
  });
});
