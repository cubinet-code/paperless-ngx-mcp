import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerPrompts } from "./prompts";

interface RegisteredPrompt {
  name: string;
  config: { description?: string; argsSchema?: Record<string, unknown> };
  callback: (args: Record<string, string | undefined>) => {
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  };
}

function createMockServer() {
  const prompts = new Map<string, RegisteredPrompt>();
  const server = {
    registerPrompt(
      name: string,
      config: RegisteredPrompt["config"],
      callback: RegisteredPrompt["callback"]
    ) {
      prompts.set(name, { name, config, callback });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { server, prompts };
}

function renderText(prompt: RegisteredPrompt, args: Record<string, string | undefined> = {}) {
  const result = prompt.callback(args);
  return result.messages[0].content.text;
}

describe("triage_inbox prompt", () => {
  test("renders a workflow that gates execution on user confirmation", () => {
    const { server, prompts } = createMockServer();
    registerPrompts(server);
    const prompt = prompts.get("triage_inbox");
    assert.ok(prompt, "triage_inbox prompt should be registered");

    const text = renderText(prompt);

    // Must instruct the model to gather existing vocabulary before proposing.
    assert.match(text, /list_tags/);
    assert.match(text, /list_correspondents/);
    assert.match(text, /list_document_types/);

    // Must require an explicit confirmation gate before any mutation.
    assert.match(text, /STOP/);
    assert.match(text, /apply/i);
    assert.match(text, /Do not call any write tools/i);

    // Must instruct preferring existing items and flagging new ones.
    assert.match(text, /\(NEW\)/);
    assert.match(text, /prefer.*existing/i);
  });

  test("limit argument flows into the rendered prompt and defaults to 25", () => {
    const { server, prompts } = createMockServer();
    registerPrompts(server);
    const prompt = prompts.get("triage_inbox")!;

    assert.match(renderText(prompt, {}), /\b25\b/);
    assert.match(renderText(prompt, { limit: "5" }), /\b5\b/);
    // Garbage input falls back to default rather than rendering "NaN".
    const fallback = renderText(prompt, { limit: "not-a-number" });
    assert.match(fallback, /\b25\b/);
    assert.doesNotMatch(fallback, /NaN/);
  });
});
