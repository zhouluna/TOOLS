"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EndpointPanel } from "@/components/endpoint-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { categoryLabel, formatShanghai, statusLabel } from "@/lib/labels";
import { useModelBenchmark, speedFor, speedLabel, sortBySpeed } from "@/lib/model-benchmark";
import { CATEGORIES, MODEL_STATUSES, type Category, type ModelStatus, type ModelView } from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
};

type ConversationSummary = {
  id: string;
  title: string;
  modelId: string;
  updatedAt: string;
};

type SyncState = {
  state: "idle" | "running";
  progress: string;
  lastSuccessAt: string | null;
  lastRun: {
    result: string;
    added: number;
    updated: number;
    suspected: number;
    offlined: number;
    error: string | null;
  } | null;
};

const KEY = "endpoint-desk.key";
const REMEMBER = "endpoint-desk.remember";
const OWNER = "endpoint-desk.owner";
const SAVE = "endpoint-desk.saveHistory";

const LAMPS: Record<ModelStatus, string> = {
  chat_ready: "bg-[#2f9e68]",
  pending_adapt: "bg-[#d0893a]",
  unconfirmed: "bg-[#8ea0b3]",
  suspected_offline: "bg-[#d0a24a]",
  offline: "bg-[#c45b5b]",
};

function ownerToken(): string {
  const existing = window.localStorage.getItem(OWNER);
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const created = crypto.randomUUID().replace(/-/g, "");
  window.localStorage.setItem(OWNER, created);
  return created;
}

function newId(): string {
  return crypto.randomUUID();
}

export function Console() {
  const [models, setModels] = useState<ModelView[]>([]);
  const [publishers, setPublishers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [status, setStatus] = useState<ModelStatus | "">("");
  const [publisher, setPublisher] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "detail">("chat");
  const [mobileList, setMobileList] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"models" | "history">("models");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [saveHistory, setSaveHistory] = useState(false);
  const [owner, setOwner] = useState("");
  const [syncIntervalHours, setSyncIntervalHours] = useState(24);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const selected = models.find((model) => model.id === selectedId) ?? null;
  const benchmark = useModelBenchmark(apiKey);
  const sortedModels = useMemo(() => sortBySpeed(models, benchmark.results), [models, benchmark.results]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (publisher) params.set("publisher", publisher);
    try {
      const response = await fetch(`/api/models?${params.toString()}`);
      const data = (await response.json()) as {
        models?: ModelView[];
        publishers?: string[];
        message?: string;
      };
      if (!response.ok) throw new Error(data.message ?? "目录没有加载出来。");
      setModels(data.models ?? []);
      setPublishers(data.publishers ?? []);
      setSelectedId((current) => current ?? data.models?.[0]?.id ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "目录没有加载出来。");
    } finally {
      setLoading(false);
    }
  }, [category, publisher, query, status]);

  const loadHistory = useCallback(async (token: string) => {
    const response = await fetch("/api/conversations", { headers: { "x-owner-token": token } });
    if (!response.ok) return;
    const data = (await response.json()) as { conversations?: ConversationSummary[] };
    setHistory(data.conversations ?? []);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const token = ownerToken();
      setOwner(token);
      setConversationId(newId());
      const remembered = window.localStorage.getItem(REMEMBER) === "1";
      setRemember(remembered);
      const stored = remembered ? window.localStorage.getItem(KEY) : window.sessionStorage.getItem(KEY);
      if (stored) setApiKey(stored);
      const saving = window.localStorage.getItem(SAVE) === "1";
      setSaveHistory(saving);
      if (saving) void loadHistory(token);
      void fetch("/api/settings")
        .then((response) => response.json())
        .then((data: { syncIntervalHours?: number }) => {
          if (data.syncIntervalHours) setSyncIntervalHours(data.syncIntervalHours);
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [loadHistory]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadModels();
    }, 180);
    return () => window.clearTimeout(handle);
  }, [loadModels]);

  const refreshSync = useCallback(async () => {
    const response = await fetch("/api/sync/status");
    if (!response.ok) return;
    const data = (await response.json()) as SyncState;
    setSyncState(data);
    return data;
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshSync();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refreshSync]);

  useEffect(() => {
    if (syncState?.state !== "running") return;
    const timer = window.setInterval(() => {
      void refreshSync().then((data) => {
        if (data && data.state === "idle") void loadModels();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadModels, refreshSync, syncState?.state]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages, sending]);

  function persistKey(value: string, rememberFlag = remember) {
    window.sessionStorage.removeItem(KEY);
    window.localStorage.removeItem(KEY);
    if (!value) return;
    if (rememberFlag) window.localStorage.setItem(KEY, value);
    else window.sessionStorage.setItem(KEY, value);
  }

  function updateKey(value: string) {
    setApiKey(value);
    persistKey(value);
  }

  function updateRemember(value: boolean) {
    setRemember(value);
    window.localStorage.setItem(REMEMBER, value ? "1" : "0");
    persistKey(apiKey, value);
  }

  function updateSaveHistory(value: boolean) {
    setSaveHistory(value);
    window.localStorage.setItem(SAVE, value ? "1" : "0");
    if (value) void loadHistory(owner);
  }

  function chooseModel(model: ModelView) {
    if (selected && messages.length > 0 && model.id !== selected.id) {
      setPendingModelId(model.id);
      return;
    }
    setSelectedId(model.id);
    setPendingModelId(null);
    setView("chat");
    setMobileList(false);
  }

  function acceptPending(keepContext: boolean) {
    if (!pendingModelId) return;
    setSelectedId(pendingModelId);
    setPendingModelId(null);
    setMobileList(false);
    setView("chat");
    if (!keepContext) {
      setMessages([]);
      setConversationId(newId());
    }
    setChatError("");
  }

  async function startSync() {
    const response = await fetch("/api/sync", { method: "POST" });
    const data = (await response.json()) as SyncState;
    setSyncState(data);
  }

  async function saveInterval(hours: number) {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-owner-token": owner },
      body: JSON.stringify({ syncIntervalHours: hours }),
    });
    const data = (await response.json()) as { message?: string; syncIntervalHours?: number };
    if (!response.ok) throw new Error(data.message ?? "没有保存。");
    setSyncIntervalHours(data.syncIntervalHours ?? hours);
  }

  async function persistConversation(nextMessages: ChatMessage[], model: ModelView, id: string) {
    if (!saveHistory || !owner) return;
    const title = nextMessages.find((message) => message.role === "user")?.content.slice(0, 24) || "未命名对话";
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-owner-token": owner },
      body: JSON.stringify({
        id,
        title,
        modelId: model.id,
        messages: nextMessages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.reasoning ? `${message.reasoning}\n${message.content}`.trim() : message.content,
        })),
      }),
    });
    await loadHistory(owner);
  }

  async function openHistory(item: ConversationSummary) {
    const response = await fetch(`/api/conversations/${item.id}`, {
      headers: { "x-owner-token": owner },
    });
    if (!response.ok) return;
    const data = (await response.json()) as {
      conversation?: { messages?: { id: string; role: "user" | "assistant"; content: string }[]; modelId: string };
    };
    const stored = data.conversation;
    if (!stored) return;
    setConversationId(item.id);
    setSelectedId(stored.modelId);
    setMessages(
      (stored.messages ?? [])
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ id: message.id, role: message.role, content: message.content })),
    );
    setSidebarTab("models");
    setMobileList(false);
    setView("chat");
  }

  async function removeHistory(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: { "x-owner-token": owner } });
    if (conversationId === id) {
      setMessages([]);
      setConversationId(newId());
    }
    await loadHistory(owner);
  }

  async function clearHistory() {
    await fetch("/api/conversations", { method: "DELETE", headers: { "x-owner-token": owner } });
    setHistory([]);
  }

  async function send() {
    if (!selected || sending) return;
    const content = draft.trim();
    if (!content) return;
    if (selected.status !== "chat_ready") {
      setChatError(statusHint(selected.status));
      return;
    }
    if (!apiKey) {
      setChatError("先在设置里输入 API Key。密钥只随这次请求转给 NVIDIA。");
      setSettingsOpen(true);
      return;
    }
    const userMessage: ChatMessage = { id: newId(), role: "user", content };
    const assistantId = newId();
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, { id: assistantId, role: "assistant", content: "", reasoning: "" }]);
    setDraft("");
    setChatError("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";
    const temperatureValue = temperature === "" ? undefined : Number(temperature);
    const maxTokensValue = maxTokens === "" ? undefined : Number(maxTokens);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nvidia-api-key": apiKey,
        },
        body: JSON.stringify({
          modelId: selected.id,
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          temperature: temperatureValue,
          maxTokens: maxTokensValue,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setMessages(messages);
        setDraft(content);
        setChatError(data.message ?? "调用没有完成。");
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("没有返回内容。");
      const decoder = new TextDecoder();
      let buffer = "";
      let reasoning = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let event: { delta?: string; reasoning?: string; error?: string };
          try {
            event = JSON.parse(data) as { delta?: string; reasoning?: string; error?: string };
          } catch {
            continue;
          }
          if (event.error) setChatError(event.error);
          answer += event.delta ?? "";
          reasoning += event.reasoning ?? "";
          const snapshotAnswer = answer;
          const snapshotReasoning = reasoning;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: snapshotAnswer, reasoning: snapshotReasoning }
                : message,
            ),
          );
        }
      }
      const finalMessages = [
        ...nextMessages,
        { id: assistantId, role: "assistant" as const, content: answer, reasoning },
      ].filter((message) => message.content || message.reasoning);
      setMessages(finalMessages);
      await persistConversation(finalMessages, selected, conversationId);
    } catch (error) {
      if (controller.signal.aborted) {
        setChatError("已停止生成。");
      } else if (!answer) {
        setMessages(messages);
        setDraft(content);
        setChatError("网络失败。输入还在，可以手动重试。");
      } else {
        setChatError(error instanceof Error ? error.message : "生成中断。已保留已经写出的内容。");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function startNewChat() {
    setMessages([]);
    setConversationId(newId());
    setChatError("");
    setDraft("");
  }

  const counts = useMemo(() => {
    const ready = models.filter((model) => model.status === "chat_ready").length;
    return { total: models.length, ready };
  }, [models]);

  return (
    <div className="flex h-dvh flex-col bg-[#e6eef3] text-[#1c2838]">
      <header className="flex items-center gap-3 border-b border-[#c9d5e0] bg-[#f7fafc] px-4 py-3">
        <div className="min-w-0">
          <p className="text-lg leading-none font-medium tracking-tight">端点台</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {syncState?.state === "running"
              ? syncState.progress || "正在同步"
              : `上次成功 ${formatShanghai(syncState?.lastSuccessAt)}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/chat" className="rounded-md border border-[#bdcbd7] bg-white px-3 py-2 text-sm hover:bg-[#edf3f7]">多模型聊天</Link>
          <Button type="button" variant="outline" onClick={startSync} disabled={syncState?.state === "running"}>
            {syncState?.state === "running" ? "同步中" : "同步目录"}
          </Button>
          <Button type="button" onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`${mobileList ? "flex" : "hidden"} w-full min-w-0 flex-col bg-[#1c2838] text-[#e7eef4] md:flex md:w-[22.5rem] md:shrink-0`}
        >
          <div className="border-b border-white/10 px-4 py-4">
            <p className="text-[1.7rem] leading-none font-medium tracking-tight">免费端点</p>
            <p className="mt-2 border-t border-[#c46a3a] pt-2 text-sm text-[#b7c6d6]">
              {counts.total} 个模型，{counts.ready} 个可以聊天
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => benchmark.running ? benchmark.stop() : void benchmark.start()} className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10">
                {benchmark.running ? "停止测速" : "测速全部聊天模型"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#b7c6d6]">使用当前 Key 逐一发送短请求，测量首段可见回答时间；每个模型最多等待 30 秒。</p>
            {benchmark.progress ? <p role="status" className="mt-1 text-xs leading-5 text-[#dbe7f1]">{benchmark.progress}</p> : null}
          </div>
          <div className="flex gap-2 px-4 pt-3">
            <button
              type="button"
              className={`text-sm ${sidebarTab === "models" ? "text-white" : "text-[#8ea0b5]"}`}
              onClick={() => setSidebarTab("models")}
            >
              模型
            </button>
            <button
              type="button"
              className={`text-sm ${sidebarTab === "history" ? "text-white" : "text-[#8ea0b5]"}`}
              onClick={() => setSidebarTab("history")}
            >
              记录
            </button>
          </div>
          {sidebarTab === "models" ? (
            <>
              <div className="space-y-3 px-4 py-3">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称或厂商"
                  aria-label="搜索模型"
                  className="border-white/15 bg-white/5 text-[#e7eef4] placeholder:text-[#8ea0b5]"
                />
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip active={category === ""} onClick={() => setCategory("")}>
                    全部分类
                  </FilterChip>
                  {CATEGORIES.map((item) => (
                    <FilterChip key={item} active={category === item} onClick={() => setCategory(item)}>
                      {categoryLabel(item)}
                    </FilterChip>
                  ))}
                </div>
                <div className="flex gap-2">
                  <select
                    aria-label="按状态筛选"
                    className="h-8 flex-1 rounded-md border border-white/15 bg-transparent px-2 text-sm"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as ModelStatus | "")}
                  >
                    <option value="">全部状态</option>
                    {MODEL_STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {statusLabel(item)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="按厂商筛选"
                    className="h-8 flex-1 rounded-md border border-white/15 bg-transparent px-2 text-sm"
                    value={publisher}
                    onChange={(event) => setPublisher(event.target.value)}
                  >
                    <option value="">全部厂商</option>
                    {publishers.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                {loading ? (
                  <div className="space-y-2 px-2">
                    <div className="h-12 animate-pulse rounded bg-white/10" />
                    <div className="h-12 animate-pulse rounded bg-white/10" />
                    <div className="h-12 animate-pulse rounded bg-white/10" />
                  </div>
                ) : loadError ? (
                  <div className="px-3 py-6 text-sm">
                    <p>{loadError}</p>
                    <Button className="mt-3" type="button" variant="secondary" onClick={() => void loadModels()}>
                      重新加载
                    </Button>
                  </div>
                ) : models.length === 0 ? (
                  <div className="px-3 py-6 text-sm leading-6 text-[#c5d3e0]">
                    目录还是空的。同步一次，从 NVIDIA 拉取标记为 Free Endpoint 的模型。
                    <Button className="mt-3" type="button" onClick={startSync}>
                      同步目录
                    </Button>
                  </div>
                ) : (
                  <ul>
                    {sortedModels.map((model) => {
                      const active = model.id === selectedId;
                      const speed = speedFor(model, benchmark.results);
                      return (
                        <li key={model.id}>
                          <button
                            type="button"
                            onClick={() => chooseModel(model)}
                            className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left ${
                              active ? "bg-[#2c415c]" : "hover:bg-white/5"
                            }`}
                          >
                            <span className={`lamp mt-1.5 ${LAMPS[model.status]}`} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm">{model.displayName}</span>
                              <span className="mt-0.5 block truncate text-xs text-[#9aafc2]">
                                {model.publisher} · {categoryLabel(model.category)} · {statusLabel(model.status)}
                              </span>
                              <span className="mt-0.5 block text-xs text-[#b9d8ef]" title={speed ? `测速时间 ${formatShanghai(speed.at)}` : undefined}>{speedLabel(model, benchmark.results)}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {!saveHistory ? (
                <p className="px-1 text-sm leading-6 text-[#c5d3e0]">
                  记录默认不保存。到设置里打开「保存聊天记录」后，新的对话会留在这台服务上。
                </p>
              ) : history.length === 0 ? (
                <p className="px-1 text-sm leading-6 text-[#c5d3e0]">还没有保存的会话。</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate px-1 py-2 text-left text-sm"
                        onClick={() => void openHistory(item)}
                      >
                        {item.title}
                      </button>
                      <button
                        type="button"
                        className="px-2 text-xs text-[#9aafc2]"
                        onClick={() => void removeHistory(item.id)}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
        <main className={`${mobileList ? "hidden" : "flex"} min-w-0 flex-1 flex-col bg-[#f7fafc] md:flex`}>
          {selected ? (
            <>
              <div className="flex items-start gap-3 border-b border-[#d5e0e8] px-4 py-4 md:px-6">
                <button
                  type="button"
                  className="mt-1 text-sm text-primary md:hidden"
                  onClick={() => setMobileList(true)}
                >
                  目录
                </button>
                <span className={`lamp mt-2 ${LAMPS[selected.status]} ${sending ? "lamp-live" : ""}`} />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-2xl font-medium tracking-tight">{selected.displayName}</h1>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {selected.endpoint?.nvidiaModelId ?? selected.id}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant={view === "chat" ? "default" : "outline"} onClick={() => setView("chat")}>
                    对话
                  </Button>
                  <Button
                    type="button"
                    variant={view === "detail" ? "default" : "outline"}
                    onClick={() => setView("detail")}
                  >
                    接口
                  </Button>
                  <Button type="button" variant="outline" onClick={startNewChat}>
                    新对话
                  </Button>
                </div>
              </div>
              {pendingModelId ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-[#ead7b0] bg-[#fff7e8] px-4 py-3 text-sm md:px-6">
                  <span>换模型会新开一段对话。</span>
                  <Button type="button" size="sm" onClick={() => acceptPending(false)}>
                    新开对话
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => acceptPending(true)}>
                    沿用已有内容
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPendingModelId(null)}>
                    留下
                  </Button>
                </div>
              ) : null}
              {view === "detail" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <EndpointPanel model={selected} />
                </div>
              ) : (
                <>
                  <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
                    {messages.length === 0 ? (
                      <div className="mx-auto max-w-2xl pt-8">
                        <p className="text-lg">{emptyChat(selected)}</p>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{selected.summary}</p>
                        <p className="mt-6 text-xs leading-5 text-muted-foreground">
                          免费标识不代表无限调用。你写下的内容会发送到 NVIDIA，请按该模型的使用条款处理敏感信息。
                        </p>
                      </div>
                    ) : (
                      <div className="mx-auto flex max-w-2xl flex-col gap-5">
                        {messages.map((message) =>
                          message.role === "user" ? (
                            <div key={message.id} className="ml-auto max-w-[85%] rounded-md bg-[#1c2838] px-3 py-2 text-sm leading-6 text-white">
                              {message.content}
                            </div>
                          ) : (
                            <div key={message.id} className="border-l-2 border-[#1f4fd8] pl-3">
                              {message.reasoning ? (
                                <p className="mb-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                                  {message.reasoning}
                                </p>
                              ) : null}
                              <p className="text-sm leading-6 whitespace-pre-wrap">
                                {message.content || (sending ? "正在写…" : "")}
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <form
                    className="border-t border-[#d5e0e8] px-4 py-3 md:px-8"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    {chatError ? <p className="mb-2 text-sm text-[#9c3b3b]">{chatError}</p> : null}
                    <div className="mx-auto flex max-w-2xl flex-col gap-2">
                      <div className="flex gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          温度
                          <Input
                            aria-label="温度"
                            className="h-7 w-16"
                            value={temperature}
                            onChange={(event) => setTemperature(event.target.value)}
                            inputMode="decimal"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          最大长度
                          <Input
                            aria-label="最大长度"
                            className="h-7 w-20"
                            value={maxTokens}
                            onChange={(event) => setMaxTokens(event.target.value)}
                            inputMode="numeric"
                          />
                        </label>
                      </div>
                      <div className="flex items-end gap-2">
                        <Textarea
                          aria-label="消息"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void send();
                            }
                          }}
                          placeholder={selected.status === "chat_ready" ? "写一条消息" : statusHint(selected.status)}
                          disabled={selected.status !== "chat_ready"}
                          className="min-h-16 flex-1 bg-white"
                        />
                        {sending ? (
                          <Button type="button" variant="outline" onClick={stop}>
                            停止
                          </Button>
                        ) : (
                          <Button type="submit" disabled={selected.status !== "chat_ready"}>
                            发送
                          </Button>
                        )}
                      </div>
                    </div>
                  </form>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
              {loading ? "正在读取目录" : "选一个模型开始"}
            </div>
          )}
        </main>
      </div>
      {syncState?.lastRun && syncState.state === "idle" ? (
        <p className="border-t border-[#d5e0e8] bg-[#f7fafc] px-4 py-1.5 text-xs text-muted-foreground">
          最近一次同步{syncState.lastRun.result === "success" ? "完成" : "失败"}
          ：新增 {syncState.lastRun.added}，更新 {syncState.lastRun.updated}，疑似下线 {syncState.lastRun.suspected}
          ，确认下线 {syncState.lastRun.offlined}
          {syncState.lastRun.error ? `。${syncState.lastRun.error}` : ""}
        </p>
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        apiKey={apiKey}
        onApiKey={updateKey}
        remember={remember}
        onRemember={updateRemember}
        saveHistory={saveHistory}
        onSaveHistory={updateSaveHistory}
        syncIntervalHours={syncIntervalHours}
        onSyncInterval={saveInterval}
        owner={owner || "未生成"}
        testModelId={selected?.status === "chat_ready" ? selected.id : null}
        onClearHistory={clearHistory}
      />
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-[#1f4fd8] text-white" : "bg-white/10 text-[#d5e2ee]"}`}
    >
      {children}
    </button>
  );
}

function emptyChat(model: ModelView): string {
  switch (model.status) {
    case "chat_ready":
      return "写第一条消息。上下文会留在这段对话里。";
    case "pending_adapt":
      return "这个免费端点已经发现，聊天还没接入。可以先看接口。";
    case "unconfirmed":
      return "免费标识或接口还不完整，暂时不能直接调用。";
    case "suspected_offline":
      return "最近一次完整同步没有看到它。历史还留着，先不要新建调用。";
    case "offline":
      return "后续同步确认它不在了，不能新建调用。";
    default: {
      const unexpected: never = model.status;
      return unexpected;
    }
  }
}

function statusHint(status: ModelStatus): string {
  switch (status) {
    case "chat_ready":
      return "写一条消息";
    case "pending_adapt":
      return "待适配，先看接口";
    case "unconfirmed":
      return "待确认，暂不能调用";
    case "suspected_offline":
      return "疑似下线";
    case "offline":
      return "已下线";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}
