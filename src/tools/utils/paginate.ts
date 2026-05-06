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
  const baseParams = new URLSearchParams();
  for (const [key, value] of Object.entries(baseArgs)) {
    if (value === undefined || value === null) continue;
    if (key === "page" || key === "page_size") continue;
    baseParams.set(key, String(value));
  }
  baseParams.set("page_size", String(FETCH_PAGE_SIZE));

  const buildQs = (page: number) => {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    return params.toString();
  };

  const firstPage = await fetcher(buildQs(1));
  const items: T[] = [...(firstPage.results ?? [])];
  if (!firstPage.next) return items;

  const totalPages =
    firstPage.count > FETCH_PAGE_SIZE
      ? Math.min(Math.ceil(firstPage.count / FETCH_PAGE_SIZE), MAX_PAGES)
      : 0;

  if (totalPages > 1) {
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => fetcher(buildQs(i + 2)))
    );
    for (const r of remaining) items.push(...(r.results ?? []));
    return items;
  }

  let page = 2;
  let next: string | null = firstPage.next;
  while (next && page <= MAX_PAGES) {
    const response = await fetcher(buildQs(page));
    items.push(...(response.results ?? []));
    next = response.next;
    page += 1;
  }
  return items;
}
