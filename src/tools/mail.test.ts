import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerMailTools } from "./mail";
import { createMockApi, createMockServer } from "./test-helpers";

describe("mail tools", () => {
  test("update_mail_account sends only the supplied fields", async () => {
    let sent: unknown;
    const { server, tools } = createMockServer();
    registerMailTools(server, createMockApi({
      request: async (_p: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return {};
      },
    }));

    await tools.get("update_mail_account")!.callback({ id: 3, imap_port: 143 });

    assert.deepEqual(sent, { imap_port: 143 });
  });

  for (const name of ["delete_mail_account", "delete_mail_rule"]) {
    test(`${name} requires confirm`, async () => {
      const { server, tools } = createMockServer();
      registerMailTools(server, createMockApi({}));
      await assert.rejects(() => tools.get(name)!.callback({ id: 1, confirm: false }), /Confirmation required/);
    });
  }
});
