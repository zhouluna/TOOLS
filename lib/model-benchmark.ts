"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelView } from "@/lib/types";

type ResultStatus = "ok" | "timeout" | "unavailable" | "forbidden" | "error";
export type SpeedResult = { status: ResultStatus; ms?: number; at: string; endpoint: string };
export type SpeedResults = Record<string, SpeedResult>;
const STORAGE_PREFIX = "endpoint-desk.speed.v1.";

function signature(model: ModelView) { return `${model.endpoint?.url ?? ""}|${model.endpoint?.nvidiaModelId ?? ""}`; }
export function speedFor(model: ModelView, results: SpeedResults): SpeedResult | undefined {
  const value = results[model.id];
  return value?.endpoint === signature(model) ? value : undefined;
}
export function speedLabel(model: ModelView, results: SpeedResults): string {
  if (model.status !== "chat_ready") return "不支持聊天测速";
  const value = speedFor(model, results);
  if (!value) return "未测速";
  if (value.status === "ok" && typeof value.ms === "number") return `首字 ${(value.ms / 1000).toFixed(1)} 秒`;
  return ({ timeout: "测速超时", unavailable: "模型不可用", forbidden: "无权限", error: "测速失败", ok: "未测速" })[value.status];
}
export function sortBySpeed(models: ModelView[], results: SpeedResults): ModelView[] {
  return [...models].sort((a, b) => {
    const av = speedFor(a, results); const bv = speedFor(b, results);
    const ams = av?.status === "ok" && typeof av.ms === "number" ? av.ms : Infinity;
    const bms = bv?.status === "ok" && typeof bv.ms === "number" ? bv.ms : Infinity;
    return ams - bms || a.displayName.localeCompare(b.displayName);
  });
}
async function storageName(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return STORAGE_PREFIX + Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
function readResults(name: string): SpeedResults {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(name) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const valid: SpeedResults = {};
    for (const [id, item] of Object.entries(parsed)) {
      if (!item || typeof item !== "object") continue;
      const r = item as SpeedResult;
      if (!["ok", "timeout", "unavailable", "forbidden", "error"].includes(r.status) || typeof r.at !== "string" || typeof r.endpoint !== "string") continue;
      if (r.status === "ok" && (typeof r.ms !== "number" || !Number.isFinite(r.ms) || r.ms < 0)) continue;
      valid[id] = r;
    }
    return valid;
  } catch { return {}; }
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Stopped", "AbortError")); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    function stop() { window.clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); }
    signal.addEventListener("abort", stop, { once: true });
  });
}
async function probe(model: ModelView, key: string, stop: AbortSignal): Promise<{ status: ResultStatus | "rate_limit" | "auth"; ms?: number }> {
  const timeout = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([stop, timeout]);
  const start = performance.now();
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json", "x-nvidia-api-key": key },
      body: JSON.stringify({ modelId: model.id, messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 512 }), signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { code?: string };
      if (response.status === 429 || body.code === "rate_limit") return { status: "rate_limit" };
      if (response.status === 401 || body.code === "auth") return { status: "auth" };
      if (response.status === 403) return { status: "forbidden" };
      if ([404, 409, 410, 503].includes(response.status)) return { status: "unavailable" };
      return { status: "error" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: "error" };
    const decoder = new TextDecoder(); let pending = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
        let event: { delta?: unknown; error?: unknown };
        try { event = JSON.parse(data); } catch { continue; }
        if (event.error) { await reader.cancel().catch(() => undefined); return { status: "error" }; }
        if (typeof event.delta === "string" && event.delta.trim()) {
          const ms = Math.round(performance.now() - start);
          void reader.cancel().catch(() => undefined);
          return { status: "ok", ms };
        }
      }
    }
    return { status: "error" };
  } catch {
    if (stop.aborted) throw new DOMException("Stopped", "AbortError");
    return { status: timeout.aborted ? "timeout" : "error" };
  }
}

export function useModelBenchmark(key: string) {
  const [results, setResults] = useState<SpeedResults>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    let active = true;
    const timer = window.setTimeout(() => {
      setResults({}); setProgress("");
      if (key) void storageName(key).then((name) => { if (active) setResults(readResults(name)); }).catch(() => undefined);
    }, 0);
    return () => { active = false; window.clearTimeout(timer); controller.current?.abort(); };
  }, [key]);

  const start = useCallback(async () => {
    if (controller.current) return;
    if (!key) { setProgress("请先在设置中输入 API Key。"); return; }
    const current = new AbortController(); controller.current = current; setRunning(true);
    let completed = 0;
    try {
      const response = await fetch("/api/models?status=chat_ready", { signal: current.signal });
      if (!response.ok) throw new Error("无法读取可聊天模型列表。");
      const data = await response.json() as { models: ModelView[] };
      const models = data.models.filter((m) => m.status === "chat_ready" && m.endpoint?.url && m.endpoint.nvidiaModelId);
      if (!models.length) { setProgress("没有可测速的聊天模型。"); return; }
      const name = await storageName(key);
      let updated = readResults(name);
      for (let i = 0; i < models.length; i++) {
        if (current.signal.aborted) throw new DOMException("Stopped", "AbortError");
        const model = models[i];
        setProgress(`测速 ${i + 1}/${models.length}：${model.displayName}`);
        const result = await probe(model, key, current.signal);
        if (current.signal.aborted) throw new DOMException("Stopped", "AbortError");
        if (result.status === "rate_limit") { setProgress(`NVIDIA 或本机限流，已停止；完成 ${completed}/${models.length}。请稍后重试。`); return; }
        if (result.status === "auth") { setProgress(`认证失败，已停止；完成 ${completed}/${models.length}。请检查 API Key。`); return; }
        updated = { ...updated, [model.id]: { status: result.status, ms: result.ms, at: new Date().toISOString(), endpoint: signature(model) } };
        completed++;
        setResults(updated);
        try { localStorage.setItem(name, JSON.stringify(updated)); } catch { setProgress("测速结果无法保存到浏览器，请检查存储空间。"); return; }
        if (i < models.length - 1) await wait(2500, current.signal);
      }
      setProgress(`测速完成：${completed}/${models.length}。结果会随网络和服务负载变化。`);
    } catch (error) {
      setProgress(current.signal.aborted ? `已停止测速，保留 ${completed} 个已完成结果。` : error instanceof Error ? error.message : "测速失败，请重试。");
    } finally { if (controller.current === current) { controller.current = null; setRunning(false); } }
  }, [key]);
  return { results, running, progress, start, stop: () => controller.current?.abort() };
}
