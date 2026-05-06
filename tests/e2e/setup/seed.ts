import axios from "axios";

const BASE_URL = process.env.PAPERLESS_E2E_URL ?? "http://localhost:8001";
const ADMIN_USER = process.env.PAPERLESS_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.PAPERLESS_ADMIN_PASSWORD ?? "admin";

interface SeedTag {
  name: string;
}
interface SeedCorrespondent {
  name: string;
}
interface SeedDocumentType {
  name: string;
}

const TAG_FIXTURES: SeedTag[] = [
  { name: "e2e-tag-alpha" },
  { name: "e2e-tag-beta" },
  { name: "e2e-tag-gamma" },
];
const CORRESPONDENT_FIXTURES: SeedCorrespondent[] = [
  { name: "e2e-correspondent-alpha" },
  { name: "e2e-correspondent-beta" },
  { name: "e2e-correspondent-gamma" },
];
const DOCUMENT_TYPE_FIXTURES: SeedDocumentType[] = [
  { name: "e2e-doctype-alpha" },
  { name: "e2e-doctype-beta" },
  { name: "e2e-doctype-gamma" },
];

async function waitForPaperless(maxWaitMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await axios.get(`${BASE_URL}/api/`, {
        validateStatus: () => true,
        timeout: 3_000,
      });
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        return;
      }
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Paperless at ${BASE_URL} did not become reachable within ${maxWaitMs}ms`);
}

async function fetchToken(): Promise<string> {
  const res = await axios.post(
    `${BASE_URL}/api/token/`,
    { username: ADMIN_USER, password: ADMIN_PASSWORD },
    { timeout: 10_000 }
  );
  if (!res.data?.token) {
    throw new Error("Paperless did not return a token");
  }
  return res.data.token;
}

async function listAll<T extends { name: string }>(
  endpoint: string,
  token: string
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${BASE_URL}/api/${endpoint}/?page_size=100`;
  while (url) {
    const res = await axios.get(url, {
      headers: { Authorization: `Token ${token}` },
      timeout: 10_000,
    });
    out.push(...(res.data.results ?? []));
    url = res.data.next ?? null;
  }
  return out;
}

async function ensureFixture<T extends { name: string }>(
  endpoint: string,
  fixture: T,
  existing: T[],
  token: string
): Promise<void> {
  if (existing.some((e) => e.name === fixture.name)) return;
  await axios.post(`${BASE_URL}/api/${endpoint}/`, fixture, {
    headers: { Authorization: `Token ${token}` },
    timeout: 10_000,
  });
}

export async function seed(): Promise<{ token: string }> {
  await waitForPaperless();
  const token = await fetchToken();

  const [tags, correspondents, types] = await Promise.all([
    listAll<SeedTag>("tags", token),
    listAll<SeedCorrespondent>("correspondents", token),
    listAll<SeedDocumentType>("document_types", token),
  ]);

  for (const tag of TAG_FIXTURES) await ensureFixture("tags", tag, tags, token);
  for (const c of CORRESPONDENT_FIXTURES)
    await ensureFixture("correspondents", c, correspondents, token);
  for (const dt of DOCUMENT_TYPE_FIXTURES)
    await ensureFixture("document_types", dt, types, token);

  return { token };
}

