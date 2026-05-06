import { z } from "zod";
import { MATCHING_ALGORITHM_DESCRIPTION } from "../../api/types";

export const paginationFields = {
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  page_size: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Number of items per page"),
};

export const nameFilterFields = {
  name__icontains: z.string().optional(),
  name__iendswith: z.string().optional(),
  name__iexact: z.string().optional(),
  name__istartswith: z.string().optional(),
};

export const matchingAlgorithmField = z
  .number()
  .int()
  .min(0)
  .max(6)
  .optional()
  .describe(MATCHING_ALGORITHM_DESCRIPTION);

export const permissionsSchema = z
  .object({
    view: z.object({
      users: z.array(z.number()).optional(),
      groups: z.array(z.number()).optional(),
    }),
    change: z.object({
      users: z.array(z.number()).optional(),
      groups: z.array(z.number()).optional(),
    }),
  })
  .optional();
