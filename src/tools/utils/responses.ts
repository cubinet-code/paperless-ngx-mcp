import { CallToolResult } from "@modelcontextprotocol/sdk/types";

const CONFIRM_MESSAGE =
  "Confirmation required for destructive operation. Set confirm: true to proceed.";

export function requireConfirm(confirm: boolean | undefined): void {
  if (!confirm) throw new Error(CONFIRM_MESSAGE);
}

export const deletedResponse = (): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ status: "deleted" }) }],
});

export function parseFilenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string
): string {
  return (
    header?.split("filename=")[1]?.replace(/"/g, "") || fallback
  );
}
