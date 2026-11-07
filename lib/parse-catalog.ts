import { CHAT_PARAMS, type Adapter, type Category, type EndpointRecord } from "@/lib/types";

const CATEGORY_ORDER: { category: Category; labels: string[] }[] = [
  { category: "chat", labels: ["chat"] },
  { category: "rerank", labels: ["reranking", "rerank"] },
  { category: "embedding", labels: ["text-to-embedding", "embedding"] },
  { category: "speech", labels: ["speech-to-text", "asr"] },
  { category: "image", labels: ["image generation", "image editing", "text-to-image", "image-to-world"] },
  { category: "vision", labels: ["image-to-text", "vision language model"] },
  { category: "chat", labels: ["text-to-text", "large language models"] },
];

export function categoryFromLabels(labels: string[]): Category {
  const normalized = labels.map((label) => label.trim().toLowerCase());
  for (const rule of CATEGORY_ORDER) {
    if (rule.labels.some((label) => normalized.includes(label))) {
      return rule.category;
    }
  }
  return "other";
}

export function adapterForUrl(url: string | null): Adapter {
  if (!url) return "unknown";
  const path = url.toLowerCase();
  if (path.includes("/chat/completions")) return "openai_chat";
  if (path.includes("/embeddings")) return "embedding";
  if (path.includes("rerank") || path.includes("/ranking")) return "rerank";
  return "other";
}

function confirmedParams(adapter: Adapter): string[] {
  switch (adapter) {
    case "openai_chat":
      return [...CHAT_PARAMS];
    case "embedding":
    case "rerank":
    case "other":
    case "unknown":
      return [];
    default: {
      const unexpected: never = adapter;
      return unexpected;
    }
  }
}

export function statusFor(endpoint: EndpointRecord | null): "chat_ready" | "pending_adapt" | "unconfirmed" {
  if (!endpoint || endpoint.confirmStatus !== "confirmed" || !endpoint.url) {
    return "unconfirmed";
  }
  switch (endpoint.adapter) {
    case "openai_chat":
      return endpoint.nvidiaModelId ? "chat_ready" : "unconfirmed";
    case "embedding":
    case "rerank":
    case "other":
      return "pending_adapt";
    case "unknown":
      return "unconfirmed";
    default: {
      const unexpected: never = endpoint.adapter;
      return unexpected;
    }
  }
}

function normalizePage(html: string): string {
  let text = html;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\"/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&");
    if (next === text) break;
    text = next;
  }
  return text;
}

function loose(value: string): string {
  return value.toLowerCase().replace(/[._]/g, "");
}

function scoreModelId(id: string, publisher: string, name: string): number {
  const normalized = id.toLowerCase();
  if (normalized.startsWith("stg/")) return 0;
  const tail = normalized.split("/").pop() ?? "";
  if (normalized === `${publisher}/${name}`.toLowerCase()) return 100;
  if (loose(tail) === loose(name)) return 80;
  return 0;
}

function isAllowedNvidiaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "integrate.api.nvidia.com" || url.hostname === "ai.api.nvidia.com")
    );
  } catch {
    return false;
  }
}

export function extractEndpoint(
  html: string,
  publisher: string,
  name: string,
  confirmedAt: string,
): EndpointRecord | null {
  const text = normalizePage(html);
  const urls = new Set<string>();
  for (const match of text.matchAll(/https:\/\/(?:integrate|ai)\.api\.nvidia\.com\/[a-zA-Z0-9_./\-]+/g)) {
    urls.add(match[0].replace(/[),.;]+$/g, ""));
  }
  const servers = [
    ...text.matchAll(/"url"\s*:\s*"(https:\/\/(?:integrate|ai)\.api\.nvidia\.com[^"]*)"/g),
  ].map((match) => match[1].replace(/\/$/, ""));
  const paths = [...text.matchAll(/"paths"\s*:\s*\{\s*"(\/[^"]+)"/g)].map((match) => match[1]);
  for (const server of new Set(servers)) {
    for (const apiPath of paths) urls.add(`${server}${apiPath}`);
  }

  const candidates = [
    ...text.matchAll(/model\s*[:=]\s*"([a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._-]{2,160})"/gi),
    ...text.matchAll(/NVIDIA NIM API for ([a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._-]{2,160})/g),
    ...text.matchAll(/"default"\s*:\s*"([a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._-]{2,160})"/g),
  ].map((match) => match[1]);

  const ranked = [...new Set(candidates)]
    .map((id) => ({ id, score: scoreModelId(id, publisher, name) }))
    .filter((item) => item.score >= 80)
    .sort((left, right) => right.score - left.score);
  const nvidiaModelId = ranked[0]?.id ?? null;

  const fullUrls = [...urls].filter((value) => {
    if (!isAllowedNvidiaUrl(value)) return false;
    try {
      const path = new URL(value).pathname;
      return path !== "/" && path !== "/v1" && path !== "/v1/";
    } catch {
      return false;
    }
  });
  const url =
    fullUrls.find((value) => value.includes("/chat/completions")) ??
    fullUrls.find((value) => /rerank|ranking|embeddings|cosmos/i.test(value)) ??
    fullUrls[0] ??
    null;

  if (!url && !nvidiaModelId) return null;
  const adapter = adapterForUrl(url);
  const confirmStatus = url ? "confirmed" : "unconfirmed";
  return {
    method: "POST",
    url,
    nvidiaModelId,
    adapter,
    confirmStatus,
    source: `https://build.nvidia.com/${publisher}/${name}`,
    confirmedAt: confirmStatus === "confirmed" ? confirmedAt : null,
    params: confirmStatus === "confirmed" ? confirmedParams(adapter) : [],
  };
}

export function isAllowedUpstream(url: string): boolean {
  return isAllowedNvidiaUrl(url);
}
