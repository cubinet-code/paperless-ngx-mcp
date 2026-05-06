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
