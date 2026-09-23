import { after, before, test, describe } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { createHarness, type E2EHarness } from "./harness";
import { seed } from "./setup/seed";
import { eventually, uploadDocument } from "./setup/document";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";
const ENCRYPTED_FIXTURE = path.resolve("tests/e2e/fixtures/encrypted-e2e-pass.pdf");

interface Workflow {
  id: number;
  name: string;
  enabled: boolean;
  triggers: Array<{ id: number; type: number }>;
  actions: Array<{ id: number; type: number; assign_title?: string | null }>;
}

describe("workflows (e2e)", () => {
  let harness: E2EHarness;
  let token: string;
  const workflowIds: number[] = [];

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  after(async () => {
    for (const id of workflowIds) {
      await harness.callTool("delete_workflow", { id, confirm: true }).catch(() => {});
    }
  });

  test("create, read, partially update, replace actions, delete", async () => {
    const name = `e2e-wf-${Date.now()}`;
    const created = await harness.callTool<Workflow>("create_workflow", {
      name,
      enabled: false,
      triggers: [{ type: 2, filter_filename: "never-matches-*" }],
      actions: [{ type: 1, assign_title: "first" }],
    });
    workflowIds.push(created.id);
    assert.equal(created.triggers.length, 1);
    assert.equal(created.actions[0].assign_title, "first");

    const fetched = await harness.callTool<Workflow>("get_workflow", { id: created.id });
    assert.equal(fetched.name, name);

    // A name-only PATCH must not touch the nested lists.
    const renamed = await harness.callTool<Workflow>("update_workflow", {
      id: created.id,
      name: `${name}-renamed`,
    });
    assert.equal(renamed.actions.length, 1);
    assert.equal(renamed.triggers.length, 1);

    // Passing `actions` replaces the list: keep+edit one by id, add one new.
    const replaced = await harness.callTool<Workflow>("update_workflow", {
      id: created.id,
      actions: [
        { id: created.actions[0].id, type: 1, assign_title: "changed" },
        { type: 6 },
      ],
    });
    assert.equal(replaced.actions.length, 2);
    assert.equal(replaced.actions.find((a) => a.id === created.actions[0].id)?.assign_title, "changed");

    const listed = await harness.callTool<{ results: Workflow[] }>("list_workflows", { page_size: 100 });
    assert.ok(listed.results.some((w) => w.id === created.id));

    await harness.callTool("delete_workflow", { id: created.id, confirm: true });
    await assert.rejects(() => harness.callTool("get_workflow", { id: created.id }), /HTTP 404/);
  });

  test("get_workflow output round-trips through update_workflow unchanged (webhook settings kept)", async () => {
    const created = await harness.callTool<Workflow>("create_workflow", {
      name: `e2e-wf-roundtrip-${Date.now()}`,
      enabled: false,
      triggers: [{ type: 2, filter_filename: "never-matches-*" }],
      actions: [
        { type: 1, assign_title: "kept" },
        {
          type: 4,
          webhook: { url: "https://example.invalid/hook", as_json: true, include_document: true },
        },
      ],
    });
    workflowIds.push(created.id);

    const fetched = await harness.callTool<Workflow>("get_workflow", { id: created.id });
    const updated = await harness.callTool<Workflow>("update_workflow", {
      id: created.id,
      triggers: fetched.triggers,
      actions: fetched.actions,
    });

    type Hook = { id: number; as_json: boolean; include_document: boolean };
    const hookOf = (w: Workflow) =>
      (w.actions.find((a) => a.type === 4) as unknown as { webhook: Hook }).webhook;
    assert.equal(updated.actions.length, 2);
    assert.equal(hookOf(updated).as_json, true);
    assert.equal(hookOf(updated).include_document, true);
    assert.equal(hookOf(updated).id, hookOf(fetched).id, "webhook keeps its identity");
  });

  test("masked PDF passwords survive a get_workflow → update_workflow round trip", async () => {
    const created = await harness.callTool<Workflow & { actions: Array<{ id: number; passwords: string[] }> }>(
      "create_workflow",
      {
        name: `e2e-wf-masked-${Date.now()}`,
        enabled: false,
        triggers: [{ type: 2, filter_filename: "never-matches-*" }],
        actions: [{ type: 5, passwords: ["pw-one", "pw-two"] }],
      }
    );
    workflowIds.push(created.id);
    assert.deepEqual(created.actions[0].passwords, ["**********", "**********"]);

    const fetched = await harness.callTool<Workflow>("get_workflow", { id: created.id });
    await harness.callTool("update_workflow", {
      id: created.id,
      triggers: fetched.triggers,
      actions: fetched.actions,
    });

    const stored = await axios.get<{ actions: Array<{ passwords: string[] }> }>(
      `${BASE_URL}/api/workflows/${created.id}/`,
      { headers: { Authorization: `Token ${token}` }, timeout: 10_000 }
    );
    assert.deepEqual(stored.data.actions[0].passwords, ["pw-one", "pw-two"]);
  });

  test("create_workflow ignores trigger/action ids copied from another workflow", async () => {
    const stamp = Date.now();
    const original = await harness.callTool<Workflow & { triggers: Array<{ id: number; filter_filename: string }> }>(
      "create_workflow",
      {
        name: `e2e-wf-original-${stamp}`,
        enabled: false,
        triggers: [{ type: 2, filter_filename: "original-*" }],
        actions: [{ type: 1, assign_title: "original" }],
      }
    );
    workflowIds.push(original.id);

    // "Duplicate this workflow": the copied objects still carry the original's ids.
    const copy = await harness.callTool<Workflow>("create_workflow", {
      name: `e2e-wf-copy-${stamp}`,
      enabled: false,
      triggers: [{ ...original.triggers[0], filter_filename: "copy-*" }],
      actions: [{ ...original.actions[0], assign_title: "copy" }],
    });
    workflowIds.push(copy.id);

    const originalAfter = await harness.callTool<Workflow & { triggers: Array<{ id: number; filter_filename: string }> }>(
      "get_workflow",
      { id: original.id }
    );
    assert.notEqual(copy.triggers[0].id, original.triggers[0].id);
    assert.equal(originalAfter.triggers[0].filter_filename, "original-*");
    assert.equal(originalAfter.actions[0].assign_title, "original");
  });

  test("delete_workflow refuses without confirm", async () => {
    await assert.rejects(
      () => harness.callTool("delete_workflow", { id: 1, confirm: false }),
      /Confirmation required/
    );
  });

  test("a password-removal workflow built through the tools unlocks an uploaded PDF", async () => {
    const prefix = `pw-wf-e2e-${Date.now()}`;
    const workflow = await harness.callTool<Workflow>("create_workflow", {
      name: prefix,
      triggers: [{ type: 2, sources: [2], filter_filename: `${prefix}*` }],
      actions: [{ type: 5, passwords: ["not-the-password", "e2e-pass"] }],
    });
    workflowIds.push(workflow.id);

    const docId = await uploadDocument(
      token,
      await fs.readFile(ENCRYPTED_FIXTURE),
      `${prefix}.pdf`
    );

    // The action runs after consumption and stores the unlocked file as a new version.
    const versions = await eventually(async () => {
      const doc = await harness.callTool<{ versions: Array<{ id: number; is_root: boolean }> }>(
        "get_document",
        { id: docId }
      );
      return doc.versions.length === 2 ? doc.versions : undefined;
    }, 60_000);
    assert.equal(versions.filter((v) => v.is_root).length, 1);

    const { content } = await harness.callTool<{ content: string }>("get_document_content", { id: docId });
    assert.match(content, /password-removal-e2e/);

    const metadata = await harness.callTool<{ original_filename: string }>("get_document_metadata", { id: docId });
    assert.match(metadata.original_filename, /_unprotected\.pdf$/);
  });
});
