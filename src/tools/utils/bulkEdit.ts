import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";
import { PaperlessAPI } from "../../api/PaperlessAPI";
import { Annotations } from "./annotations";
import { withErrorHandling } from "./middlewares";
import { requireConfirm } from "./responses";
import { permissionsSchema } from "./schemas";

interface RegisterBulkEditToolOptions {
  toolName: string;
  description: string;
  idsField: string;
  objectType: string;
}

export function registerBulkEditTool(
  server: McpServer,
  api: PaperlessAPI,
  { toolName, description, idsField, objectType }: RegisterBulkEditToolOptions
) {
  const schema = {
    [idsField]: z.array(z.number()),
    operation: z.enum(["set_permissions", "delete"]),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "Must be true when operation is 'delete' to confirm destructive operation"
      ),
    owner: z.number().optional(),
    permissions: permissionsSchema,
    merge: z.boolean().optional(),
  };

  server.tool(
    toolName,
    description,
    schema,
    Annotations.BULK_EDIT,
    withErrorHandling(async (args) => {
      if (args.operation === "delete") requireConfirm(args.confirm);
      const result = await api.bulkEditObjects(
        args[idsField] as number[],
        objectType,
        args.operation,
        args.operation === "set_permissions"
          ? {
              owner: args.owner,
              permissions: args.permissions,
              merge: args.merge,
            }
          : {}
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    })
  );
}
