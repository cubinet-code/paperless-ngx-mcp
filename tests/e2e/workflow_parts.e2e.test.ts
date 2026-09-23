import { after, before, test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type E2EHarness } from "./harness";
import { ensureCustomField, findIdByName, seed } from "./setup/seed";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";

interface Action {
  id: number;
  type: number;
  [key: string]: unknown;
}
interface Trigger {
  id: number;
  type: number;
  [key: string]: unknown;
}

describe("workflow actions & triggers (e2e) — Paperless 3.2 fields", () => {
  let harness: E2EHarness;
  let token: string;
  const actionIds: number[] = [];
  const triggerIds: number[] = [];

  before(async () => {
    ({ token } = await seed());
    harness = createHarness(BASE_URL, token);
  });

  after(async () => {
    // Paperless prunes unattached actions/triggers on any workflow update, so
    // some of these may already be gone.
    for (const id of actionIds) {
      await harness.callTool("delete_workflow_action", { id, confirm: true }).catch(() => {});
    }
    for (const id of triggerIds) {
      await harness.callTool("delete_workflow_trigger", { id, confirm: true }).catch(() => {});
    }
  });

  const createAction = async (args: Record<string, unknown>) => {
    const action = await harness.callTool<Action>("create_workflow_action", args);
    actionIds.push(action.id);
    return action;
  };

  test("password removal (type 5) round-trips its ordered passwords list", async () => {
    const action = await createAction({ type: 5, passwords: ["first", "second"] });

    assert.equal(action.type, 5);
    assert.deepEqual(action.passwords, ["first", "second"]);
  });

  test("move to trash (6), remote OCR (7) and apply AI suggestions (8) are accepted", async () => {
    const trash = await createAction({ type: 6 });
    const ocr = await createAction({ type: 7 });
    const ai = await createAction({
      type: 8,
      ai_suggestion_fields: ["title", "tags"],
      ai_create_missing: true,
      ai_overwrite_existing: false,
    });

    assert.equal(trash.type, 6);
    assert.equal(ocr.type, 7);
    assert.deepEqual(ai.ai_suggestion_fields, ["title", "tags"]);
    assert.equal(ai.ai_create_missing, true);
  });

  test("update_workflow_action sets the per-item removal lists", async () => {
    const correspondent = await findIdByName(token, "correspondents", "e2e-correspondent-alpha");
    const documentType = await findIdByName(token, "document_types", "e2e-doctype-alpha");
    const action = await createAction({ type: 2 });

    const updated = await harness.callTool<Action>("update_workflow_action", {
      id: action.id,
      remove_correspondents: [correspondent],
      remove_document_types: [documentType],
    });

    assert.deepEqual(updated.remove_correspondents, [correspondent]);
    assert.deepEqual(updated.remove_document_types, [documentType]);
  });

  test("assignment action round-trips assign_custom_fields_values", async () => {
    const field = await ensureCustomField(token, "e2e-wf-string", "string");

    const action = await createAction({
      type: 1,
      assign_custom_fields: [field.id],
      assign_custom_fields_values: { [String(field.id)]: "from-workflow" },
    });

    assert.deepEqual(action.assign_custom_fields_values, { [String(field.id)]: "from-workflow" });
  });

  test("trigger any/all/not filters and custom field query round-trip", async () => {
    const correspondent = await findIdByName(token, "correspondents", "e2e-correspondent-alpha");
    const documentType = await findIdByName(token, "document_types", "e2e-doctype-beta");
    const tagA = await findIdByName(token, "tags", "e2e-tag-alpha");
    const tagB = await findIdByName(token, "tags", "e2e-tag-beta");
    const tagC = await findIdByName(token, "tags", "e2e-tag-gamma");
    const field = await ensureCustomField(token, "e2e-wf-string", "string");
    const query = JSON.stringify([field.name, "exists", true]);

    const trigger = await harness.callTool<Trigger>("create_workflow_trigger", {
      type: 3,
      filter_has_any_correspondents: [correspondent],
      filter_has_not_document_types: [documentType],
      filter_has_all_tags: [tagA, tagB],
      filter_has_not_tags: [tagC],
      filter_custom_field_query: query,
    });
    triggerIds.push(trigger.id);

    assert.deepEqual(trigger.filter_has_any_correspondents, [correspondent]);
    assert.deepEqual(trigger.filter_has_not_document_types, [documentType]);
    assert.deepEqual([...(trigger.filter_has_all_tags as number[])].sort(), [tagA, tagB].sort());
    assert.deepEqual(trigger.filter_has_not_tags, [tagC]);
    assert.equal(trigger.filter_custom_field_query, query);
  });

  test("trigger matching_algorithm 6 (auto) is rejected before reaching Paperless", async () => {
    await assert.rejects(
      () => harness.callTool("create_workflow_trigger", { type: 2, matching_algorithm: 6 }),
      (err: Error) => {
        assert.equal(err.name, "ZodError", `expected a schema rejection, got: ${err.message}`);
        return true;
      }
    );
  });
});
