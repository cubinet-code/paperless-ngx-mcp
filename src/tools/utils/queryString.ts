type QueryValue = string | number | boolean | null | undefined;

export function buildQueryString(args: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }
  return query.toString();
}
