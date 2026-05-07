import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PaperlessAPI } from "../../src/api/PaperlessAPI";
import { registerCorrespondentTools } from "../../src/tools/correspondents";
import { registerCustomFieldTools } from "../../src/tools/customFields";
import { registerDocumentTools } from "../../src/tools/documents";
import { registerDocumentTypeTools } from "../../src/tools/documentTypes";
import { registerSavedViewTools } from "../../src/tools/savedViews";
import { registerShareLinkTools } from "../../src/tools/shareLinks";
import { registerStoragePathTools } from "../../src/tools/storagePaths";
import { registerSystemTools } from "../../src/tools/system";
import { registerTagTools } from "../../src/tools/tags";
import { registerWorkflowTools } from "../../src/tools/workflows";

interface RegisteredTool {
  name: string;
  description: string;
  schema: unknown;
  callback: (args: Record<string, unknown>, extra?: unknown) => Promise<CallToolResult>;
}

export interface E2EHarness {
  callTool: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>;
  api: PaperlessAPI;
}

export function createHarness(baseUrl: string, token: string): E2EHarness {
  const api = new PaperlessAPI(baseUrl, token);
  const tools = new Map<string, RegisteredTool>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server: any = {
    tool(
      name: string,
      description: string,
      schema: unknown,
      annotationsOrCallback: unknown,
      maybeCallback?: unknown
    ) {
      const callback = (maybeCallback ?? annotationsOrCallback) as RegisteredTool["callback"];
      tools.set(name, { name, description, schema, callback });
    },
  };

  registerDocumentTools(server, api);
  registerTagTools(server, api);
  registerCorrespondentTools(server, api);
  registerDocumentTypeTools(server, api);
  registerCustomFieldTools(server, api);
  registerStoragePathTools(server, api);
  registerSavedViewTools(server, api);
  registerShareLinkTools(server, api);
  registerWorkflowTools(server, api);
  registerSystemTools(server, api);

  return {
    api,
    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool not registered: ${name}`);
      // Apply the tool's Zod schema like the real MCP SDK does, so e2e tests
      // exercise the full input pipeline (schema validation + body + API).
      const validated = z.object(tool.schema as z.ZodRawShape).parse(args);
      const result = await tool.callback(validated as Record<string, unknown>);
      const textItem = result.content.find((c) => c.type === "text");
      if (!textItem || !("text" in textItem)) {
        throw new Error(`Tool ${name} returned no text content`);
      }
      return JSON.parse(textItem.text) as T;
    },
  };
}
