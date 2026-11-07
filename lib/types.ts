export const CATEGORIES = [
  "chat",
  "vision",
  "embedding",
  "rerank",
  "speech",
  "image",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const MODEL_STATUSES = [
  "chat_ready",
  "pending_adapt",
  "unconfirmed",
  "suspected_offline",
  "offline",
] as const;

export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const ADAPTERS = [
  "openai_chat",
  "embedding",
  "rerank",
  "other",
  "unknown",
] as const;

export type Adapter = (typeof ADAPTERS)[number];

export type EndpointRecord = {
  method: "POST";
  url: string | null;
  nvidiaModelId: string | null;
  adapter: Adapter;
  confirmStatus: "confirmed" | "unconfirmed";
  source: string;
  confirmedAt: string | null;
  params: string[];
};

export type DiscoveredModel = {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  summary: string;
  category: Category;
  labels: string[];
  pageUrl: string;
  logoUrl: string | null;
  freeSource: string;
  endpoint: EndpointRecord | null;
};

export type ModelView = DiscoveredModel & {
  status: ModelStatus;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type SyncRunView = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  result: "running" | "success" | "failed";
  added: number;
  updated: number;
  suspected: number;
  offlined: number;
  error: string | null;
  complete: boolean;
};

export const CHAT_PARAMS = [
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
] as const;
