import type { ChatTurn } from "@/lib/chat-types";

export type { ChatTurn } from "@/lib/chat-types";

export function sanitizeMessages(input: unknown): ChatTurn[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 40) return null;
  const messages: ChatTurn[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "system" && role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 16_000) return null;
    messages.push({ role, content: trimmed });
  }
  if (!messages.some((message) => message.role === "user")) return null;
  return messages;
}

export function readApiKey(request: Request): string | null {
  const raw = request.headers.get("x-nvidia-api-key") ?? "";
  const value = raw.replace(/^Bearer\s+/i, "").trim();
  if (!/^nvapi-[A-Za-z0-9_-]{20,180}$/.test(value)) return null;
  return value;
}

export function readOwner(request: Request): string | null {
  const token = request.headers.get("x-owner-token") ?? "";
  return /^[a-f0-9]{32}$/.test(token) ? token : null;
}

export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}
