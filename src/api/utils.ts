import { MATCHING_ALGORITHM_OPTIONS, MatchingAlgorithm } from "./types";

const isKnownMatchingAlgorithm = (n: number): n is MatchingAlgorithm =>
  n in MATCHING_ALGORITHM_OPTIONS;

type IterableHeaders = {
  forEach: (cb: (value: string, key: string) => void) => void;
};

export const headersToObject = (
  headers: unknown
): Record<string, string> => {
  if (!headers) return {};
  if (
    typeof headers === "object" &&
    typeof (headers as IterableHeaders).forEach === "function"
  ) {
    const obj: Record<string, string> = {};
    (headers as IterableHeaders).forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  return headers as Record<string, string>;
};

export interface NamedItem {
  id: number;
  name: string;
}

export function enhanceMatchingAlgorithm<
  T extends { matching_algorithm: number }
>(obj: T): T & { matching_algorithm: NamedItem } {
  return {
    ...obj,
    matching_algorithm: {
      id: obj.matching_algorithm,
      name: isKnownMatchingAlgorithm(obj.matching_algorithm)
        ? MATCHING_ALGORITHM_OPTIONS[obj.matching_algorithm]
        : String(obj.matching_algorithm),
    },
  };
}

export function enhanceMatchingAlgorithmArray<
  T extends { matching_algorithm: number }
>(objects: T[]): (T & { matching_algorithm: NamedItem })[] {
  return objects.map((obj) => enhanceMatchingAlgorithm(obj));
}

/**
 * Turns a Paperless error body into one line. DRF sends `{detail}` for most
 * errors but `{field: [msg]}` / `{non_field_errors: [msg]}` for validation
 * failures, and some views answer in plain text ("AI is required for this
 * feature"). Django's HTML error pages carry nothing useful and are dropped.
 */
export function describeErrorBody(data: unknown): string | undefined {
  if (typeof data === "string") {
    const text = data.trim();
    return text && !text.startsWith("<") ? text.slice(0, 500) : undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["detail", "error", "message"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  const json = JSON.stringify(record);
  return json === "{}" ? undefined : json.slice(0, 500);
}
