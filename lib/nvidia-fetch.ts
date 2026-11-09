import { categoryFromLabels, extractEndpoint } from "@/lib/parse-catalog";
import { nvidiaFetch } from "@/lib/nvidia-http";
import type { DiscoveredModel } from "@/lib/types";

const CATALOG_URL = "https://api.ngc.nvidia.com/v2/search/catalog/resources/ENDPOINT";
const USER_AGENT = "endpoint-desk/1.0 (personal catalog sync)";
const PAGE_BYTE_LIMIT = 6_000_000;

type CatalogLabel = { key?: string; values?: string[] };
type CatalogAttribute = { key?: string; value?: string };
type CatalogResource = {
  name?: string;
  displayName?: string;
  description?: string;
  labels?: CatalogLabel[];
  attributes?: CatalogAttribute[];
};

type CatalogResponse = {
  resultPageTotal?: number;
  results?: { groupValue?: string; resources?: CatalogResource[] }[];
};

export type DiscoverOptions = {
  onProgress?: (message: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => string;
};

function labelValues(resource: CatalogResource): string[] {
  const values: string[] = [];
  for (const label of resource.labels ?? []) {
    for (const value of label.values ?? []) values.push(value);
  }
  return values;
}

function publisherOf(resource: CatalogResource): string | null {
  const publisher = resource.labels?.find((label) => label.key === "publisher");
  const value = publisher?.values?.[0]?.trim();
  return value || null;
}

function logoOf(resource: CatalogResource): string | null {
  const logo = resource.attributes?.find((attribute) => attribute.key === "logo")?.value;
  if (!logo || !logo.startsWith("https://assets.ngc.nvidia.com/")) return null;
  return logo;
}

function isFree(labels: string[]): boolean {
  return labels.includes("Free Endpoint");
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (received < limit) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    text += decoder.decode(chunk.value, { stream: true });
    if (received >= limit) {
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return text;
}

export async function fetchCatalogResources(fetchImpl: typeof fetch): Promise<CatalogResource[]> {
  const resources: CatalogResource[] = [];
  let page = 0;
  let pageTotal = 1;
  while (page < pageTotal && page < 10) {
    const query = {
      query: "*",
      page,
      pageSize: 100,
      filters: [
        { field: "orgName", value: "qc69jvmznzxy" },
        { field: "resourceType", value: "endpoint" },
        { field: "isPublic", value: "true" },
      ],
    };
    const url = `${CATALOG_URL}?q=${encodeURIComponent(JSON.stringify(query))}`;
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(`catalog_${response.status}`);
    }
    const payload = (await response.json()) as CatalogResponse;
    pageTotal = payload.resultPageTotal ?? page + 1;
    for (const group of payload.results ?? []) {
      if (group.groupValue === "ENDPOINT") {
        resources.push(...(group.resources ?? []));
      }
    }
    page += 1;
  }
  return resources;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

export async function discoverCatalogModels(options: DiscoverOptions = {}): Promise<DiscoveredModel[]> {
  const fetchImpl = options.fetchImpl ?? nvidiaFetch;
  options.onProgress?.("正在读取 NVIDIA 模型目录");
  const resources = await fetchCatalogResources(fetchImpl);
  const discovered: DiscoveredModel[] = [];
  for (const resource of resources) {
    const name = resource.name?.trim();
    const publisher = publisherOf(resource);
    if (!name || !publisher) continue;
    const labels = labelValues(resource);
    if (!isFree(labels)) continue;
    discovered.push({
      id: `${publisher}/${name}`,
      name,
      displayName: resource.displayName?.trim() || name,
      publisher,
      summary: resource.description?.trim() || "目录没有提供简介。",
      category: categoryFromLabels(labels),
      labels,
      pageUrl: `https://build.nvidia.com/${publisher}/${name}`,
      logoUrl: logoOf(resource),
      freeSource: "NVIDIA 目录标签 Free Endpoint",
      // Hosted sync skips per-model HTML scrapes; applyDiscovered reuses stored endpoints.
      endpoint: null,
    });
  }
  options.onProgress?.(`目录列表 ${discovered.length} 个免费端点（未抓取模型页）`);
  const unique = new Map<string, DiscoveredModel>();
  for (const model of discovered) unique.set(model.id, model);
  return [...unique.values()];
}

export async function discoverFreeModels(options: DiscoverOptions = {}): Promise<DiscoveredModel[]> {
  const fetchImpl = options.fetchImpl ?? nvidiaFetch;
  const now = options.now ?? (() => new Date().toISOString());
  const confirmedAt = now();
  options.onProgress?.("正在读取 NVIDIA 模型目录");
  const resources = await fetchCatalogResources(fetchImpl);
  const free = resources.filter((resource) => {
    const name = resource.name?.trim();
    const publisher = publisherOf(resource);
    return Boolean(name && publisher && isFree(labelValues(resource)));
  });
  options.onProgress?.(`目录里有 ${free.length} 个免费端点，正在核对接口`);

  const discovered: DiscoveredModel[] = new Array(free.length);
  await mapPool(free, 3, async (resource, index) => {
    const name = resource.name?.trim() ?? "";
    const publisher = publisherOf(resource) ?? "";
    const labels = labelValues(resource);
    const pageUrl = `https://build.nvidia.com/${publisher}/${name}`;
    let endpoint = null;
    try {
      const response = await fetchImpl(pageUrl, {
        headers: { accept: "text/html", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) {
        const html = await readLimited(response, PAGE_BYTE_LIMIT);
        endpoint = extractEndpoint(html, publisher, name, confirmedAt);
      }
    } catch {
      endpoint = null;
    }
    discovered[index] = {
      id: `${publisher}/${name}`,
      name,
      displayName: resource.displayName?.trim() || name,
      publisher,
      summary: resource.description?.trim() || "目录没有提供简介。",
      category: categoryFromLabels(labels),
      labels,
      pageUrl,
      logoUrl: logoOf(resource),
      freeSource: "NVIDIA 目录标签 Free Endpoint",
      endpoint,
    };
    if (index % 8 === 0) {
      options.onProgress?.(`已核对 ${index + 1}/${free.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  const unique = new Map<string, DiscoveredModel>();
  for (const model of discovered) {
    if (model) unique.set(model.id, model);
  }
  return [...unique.values()];
}
