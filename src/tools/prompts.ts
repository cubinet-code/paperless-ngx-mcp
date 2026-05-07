import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "triage_inbox",
    {
      title: "Triage inbox",
      description:
        "Scan inbox documents, propose metadata (correspondent, document type, tags) preferring existing items, and apply only after explicit user confirmation.",
      argsSchema: {
        limit: z
          .string()
          .optional()
          .describe("Max number of inbox documents to triage in one pass (default: 25)"),
      },
    },
    ({ limit }) => {
      const max = limit && /^\d+$/.test(limit) ? parseInt(limit, 10) : 25;
      const body = `Triage the Paperless-NGX inbox. Follow these steps strictly — do NOT mutate anything until the user confirms.

## Step 1 — Discover the inbox and current vocabulary

1. Call \`list_tags\` with a large \`page_size\` (e.g. 200) and identify the tag where \`is_inbox_tag\` is true. Remember its id and name.
2. Call \`list_correspondents\`, \`list_document_types\`, and \`list_tags\` once each (large \`page_size\`) and keep the full lists in mind for matching. Do not refetch later.

## Step 2 — Fetch inbox documents

Call \`list_documents\` with \`tag\` set to the inbox tag id, ordered by \`-created\`. Process up to **${max}** documents this pass. For each document, if title alone is not enough to classify, fetch \`get_document_content\` (one at a time, only when needed).

## Step 3 — Propose metadata, preferring existing items

For each inbox document, propose:
- **correspondent**: pick the best existing match by name/aliases. Only propose creating a new one if no reasonable existing match exists.
- **document_type**: same rule — prefer existing.
- **tags**: prefer existing tags that already cover the topic. Only propose new tags when a clearly distinct concept is missing.
- Always plan to **remove the inbox tag** once metadata is set.

Matching guidance: be generous with semantic matches (e.g. "ACME Corp" ≈ "ACME Corporation"), but never silently merge clearly different entities. When uncertain, mark it and ask.

## Step 4 — Present a confirmation table and STOP

Render a single markdown table with one row per document:

| ID | Title | Correspondent | Doc Type | Tags + / − | New items? | Notes |
|---|---|---|---|---|---|---|

- Use \`(existing)\` or \`(NEW)\` next to any proposed correspondent / type / tag so the user can see at a glance what would be created.
- Show tag changes as \`+TagA, +TagB, −Inbox\`.
- After the table, list any "New items?" entries explicitly so the user can veto creations.
- End with: **"Reply 'apply' to execute, or tell me what to change."**

Then STOP. Do not call any write tools yet.

## Step 5 — Execute only on explicit confirmation

After the user confirms (e.g. "apply", "yes, go ahead", or a modified instruction):

1. Create any approved new correspondents / document types / tags first (\`create_correspondent\`, \`create_document_type\`, \`create_tag\`).
2. Group document changes by operation and use \`edit_documents_bulk\` where possible:
   - \`set_correspondent\` for batches sharing the same correspondent
   - \`set_document_type\` for batches sharing the same type
   - \`add_tag\` / \`remove_tag\` (including removing the inbox tag) per tag
3. For per-document fields not covered by bulk edits (e.g. title cleanup), use \`update_document\`.
4. After applying, report a short summary: counts of documents updated, items created, and any failures.

If the user's reply is ambiguous, ask before executing. Never assume "looks good" means "apply".`;

      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: body },
          },
        ],
      };
    }
  );
}
