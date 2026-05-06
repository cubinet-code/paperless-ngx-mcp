interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

const FETCH_PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export async function fetchAllPages<T>(
  fetcher: (queryString: string) => Promise<PaginatedResponse<T>>,
  baseArgs: Record<string, unknown> = {}
): Promise<T[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(baseArgs)) {
    if (value === undefined || value === null) continue;
    if (key === "page" || key === "page_size") continue;
    params.set(key, String(value));
  }
  params.set("page_size", String(FETCH_PAGE_SIZE));

  const collected: T[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    params.set("page", String(page));
    const response = await fetcher(params.toString());
    collected.push(...(response.results ?? []));
    if (!response.next) break;
    page += 1;
  }
  return collected;
}
