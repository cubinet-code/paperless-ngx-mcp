import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import {
  enhanceMatchingAlgorithmArray,
  NamedItem,
} from "../../api/utils";
import { fetchAllPages } from "./paginate";

interface CountedItem {
  id: number;
  document_count: number;
  matching_algorithm: number;
}

interface PaginatedFetcherResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export async function applyIsEmptyFilter<T extends CountedItem>(
  fetcher: (queryString: string) => Promise<PaginatedFetcherResponse<T>>,
  apiArgs: Record<string, unknown>,
  isEmpty: boolean
): Promise<CallToolResult> {
  const all = await fetchAllPages(fetcher, apiArgs);
  const filtered = all.filter((item) =>
    isEmpty ? item.document_count === 0 : item.document_count > 0
  );
  const enhanced: (T & { matching_algorithm: NamedItem })[] =
    enhanceMatchingAlgorithmArray(filtered);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          count: enhanced.length,
          next: null,
          previous: null,
          all: enhanced.map((item) => item.id),
          results: enhanced,
        }),
      },
    ],
  };
}
