import { after, before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { findIdByName, seed } from "./setup/seed";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

const ACCOUNT = {
  imap_server: "imap.example.invalid",
  imap_port: 993,
  imap_security: 2,
  username: "e2e-user",
  password: "e2e-secret",
};

describe("mail accounts & rules (e2e)", () => {
  let harness: E2EHarness;
  let token: string;
  let accountId: number | undefined;
  let ruleId: number | undefined;

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  after(async () => {
    if (ruleId) await harness.callTool("delete_mail_rule", { id: ruleId, confirm: true }).catch(() => {});
    if (accountId) await harness.callTool("delete_mail_account", { id: accountId, confirm: true }).catch(() => {});
  });

  test("account CRUD keeps the password write-only", async () => {
    const created = await harness.callTool<{ id: number; password: string }>("create_mail_account", {
      name: `e2e-mail-${Date.now()}`,
      ...ACCOUNT,
    });
    accountId = created.id;
    assert.equal(created.password, "**********");

    const updated = await harness.callTool<{ imap_port: number }>("update_mail_account", {
      id: accountId,
      imap_port: 143,
      imap_security: 3,
    });
    assert.equal(updated.imap_port, 143);

    const listed = await harness.callTool<{ results: Array<{ id: number }> }>("list_mail_accounts", {});
    assert.ok(listed.results.some((a) => a.id === accountId));
  });

  test("rule CRUD with a fixed correspondent", async () => {
    const correspondent = await findIdByName(token, "correspondents", "e2e-correspondent-alpha");
    const rule = await harness.callTool<{ id: number; folder: string; assign_correspondent_from: number }>(
      "create_mail_rule",
      {
        name: `e2e-rule-${Date.now()}`,
        account: accountId,
        assign_correspondent_from: 4,
        assign_correspondent: correspondent,
        filter_attachment_filename_include: "*.pdf",
      }
    );
    ruleId = rule.id;
    assert.equal(rule.folder, "INBOX");
    assert.equal(rule.assign_correspondent_from, 4);

    const updated = await harness.callTool<{ enabled: boolean }>("update_mail_rule", { id: ruleId, enabled: false });
    assert.equal(updated.enabled, false);

    const fetched = await harness.callTool<{ account: number }>("get_mail_rule", { id: ruleId });
    assert.equal(fetched.account, accountId);
  });

  test("test_mail_account reports an unreachable server as a readable error", async () => {
    await assert.rejects(
      () => harness.callTool("test_mail_account", { name: "probe", ...ACCOUNT }),
      (err: Error) => {
        assert.match(err.message, /HTTP 500/);
        assert.doesNotMatch(err.message, /<html|<!doctype/i);
        return true;
      }
    );
  });

  test("test_mail_account sends the saved account's id (so the masked password means 'use the stored one')", async () => {
    // Upstream checks permissions on the account named by id; an unknown id is
    // refused with 403 — which only happens if the id reaches the wire.
    await assert.rejects(
      () => harness.callTool("test_mail_account", { id: 99_999_999, name: "probe", ...ACCOUNT, password: "**********" }),
      /Insufficient permissions|HTTP 403/
    );
  });

  test("process_mail_account queues a fetch", async () => {
    const result = await harness.callTool<{ result: string }>("process_mail_account", { id: accountId });
    assert.equal(result.result, "OK");
  });

  test("deletes require confirm", async () => {
    await assert.rejects(() => harness.callTool("delete_mail_rule", { id: ruleId, confirm: false }), /Confirmation required/);
    await assert.rejects(() => harness.callTool("delete_mail_account", { id: accountId, confirm: false }), /Confirmation required/);
  });
});
