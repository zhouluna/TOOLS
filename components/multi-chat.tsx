"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ModelView } from "@/lib/types";
import type { MultiConversation, MultiMessage } from "@/lib/multi-conversations";
import { useModelBenchmark, speedLabel, sortBySpeed } from "@/lib/model-benchmark";

type Summary = { id: string; title: string; modelId: string; updatedAt: string };
const KEY = "endpoint-desk.key";
const OWNER = "endpoint-desk.owner";
const SAVE = "endpoint-desk.saveHistory";

function contextFor(messages: MultiMessage[], draft: string) {
  let previous = messages.filter((m) => m.content.trim()).slice(-39);
  // Start with a user message so that the selected history begins on a complete turn.
  while (previous.length && previous[0].role !== "user") previous = previous.slice(1);
  return [...previous.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: draft.trim() }];
}

export function MultiChat() {
  const [models, setModels] = useState<ModelView[]>([]);
  const [modelId, setModelId] = useState("");
  const [key, setKey] = useState("");
  const [owner, setOwner] = useState("");
  const [saveHistory, setSaveHistory] = useState(false);
  const [history, setHistory] = useState<Summary[]>([]);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<MultiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const selected = models.find((m) => m.id === modelId);
  const benchmark = useModelBenchmark(key);
  const context = contextFor(messages, draft);
  const omitted = messages.filter((m) => m.content.trim()).length - (context.length - 1);

  const refreshHistory = useCallback(async (token: string) => {
    const response = await fetch("/api/multi-conversations", { headers: { "x-owner-token": token } });
    if (!response.ok) throw new Error("会话列表读取失败。");
    const data = await response.json() as { conversations: Summary[] };
    setHistory(data.conversations);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let token = localStorage.getItem(OWNER) ?? "";
      if (!/^[a-f0-9]{32}$/.test(token)) { token = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem(OWNER, token); }
      setOwner(token); setId(crypto.randomUUID());
      setKey(localStorage.getItem("endpoint-desk.remember") === "1" ? localStorage.getItem(KEY) ?? "" : sessionStorage.getItem(KEY) ?? "");
      const saving = localStorage.getItem(SAVE) === "1";
      setSaveHistory(saving);
      if (saving) void refreshHistory(token).catch(() => setError("会话列表读取失败。"));
      void fetch("/api/models?status=chat_ready").then(async (response) => {
        if (!response.ok) throw new Error("无法读取模型目录。");
        const data = await response.json() as { models: ModelView[] };
        setModels(data.models); setModelId((current) => current || data.models[0]?.id || "");
      }).catch(() => setError("无法读取模型目录，请返回配置页检查。"));
    }, 0);
    return () => { clearTimeout(timer); abort.current?.abort(); };
  }, [refreshHistory]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages]);

  async function persist(next: MultiMessage[], currentModel: string, nextTitle = title) {
    if (!saveHistory || !owner || !next.length) return;
    const resolved = nextTitle || next.find((m) => m.role === "user")?.content.slice(0, 24) || "未命名对话";
    const response = await fetch("/api/multi-conversations", {
      method: "POST", headers: { "content-type": "application/json", "x-owner-token": owner },
      body: JSON.stringify({ id, title: resolved, modelId: currentModel, messages: next }),
    });
    if (!response.ok) throw new Error("对话未能保存，请检查本机服务。当前页面中的内容仍在。");
    setTitle(resolved);
    await refreshHistory(owner);
  }

  function startNew() { setId(crypto.randomUUID()); setTitle(""); setMessages([]); setDraft(""); setError(""); }
  async function openConversation(item: Summary) {
    try {
      const response = await fetch(`/api/multi-conversations/${encodeURIComponent(item.id)}`, { headers: { "x-owner-token": owner } });
      if (!response.ok) throw new Error("无法读取会话。");
      const data = await response.json() as { conversation: MultiConversation };
      setId(data.conversation.id); setTitle(data.conversation.title); setMessages(data.conversation.messages);
      setModelId(data.conversation.modelId); setDraft(""); setError("");
    } catch { setError("无法读取会话，请重试。"); }
  }
  async function removeConversation(item: Summary) {
    if (!window.confirm(`删除对话“${item.title}”？此操作无法撤销。`)) return;
    try {
      const response = await fetch(`/api/multi-conversations/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { "x-owner-token": owner } });
      if (!response.ok) throw new Error();
      if (item.id === id) startNew();
      await refreshHistory(owner);
    } catch { setError("删除失败，请重试。"); }
  }
  async function renameConversation(item: Summary) {
    const name = window.prompt("输入会话名称", item.title)?.trim();
    if (!name) return;
    if (name.length > 80) { setError("会话名称不能超过 80 个字符。"); return; }
    try {
      const response = await fetch(`/api/multi-conversations/${encodeURIComponent(item.id)}`, { headers: { "x-owner-token": owner } });
      if (!response.ok) throw new Error();
      const data = await response.json() as { conversation: MultiConversation };
      const saved = await fetch("/api/multi-conversations", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": owner }, body: JSON.stringify({ ...data.conversation, title: name }) });
      if (!saved.ok) throw new Error();
      if (item.id === id) setTitle(name);
      await refreshHistory(owner);
    } catch { setError("重命名失败，请重试。"); }
  }
  async function switchModel(value: string) {
    setSwitching(true); setModelId(value); setError("");
    try { await persist(messages, value); } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); }
    finally { setSwitching(false); }
  }
  async function send() {
    const content = draft.trim();
    if (!content || sending || switching) return;
    if (!key) { setError("请先返回模型配置，在设置中输入 API Key。"); return; }
    if (!selected || selected.status !== "chat_ready") { setError("请选择可聊天的模型。"); return; }
    const outgoing = contextFor(messages, content);
    if (outgoing.some((m) => m.content.length > 16000)) { setError("本次上下文包含超过 16,000 字符的消息，请新建对话或缩短消息后重试。"); return; }
    const user: MultiMessage = { id: crypto.randomUUID(), role: "user", content };
    const reply: MultiMessage = { id: crypto.randomUUID(), role: "assistant", content: "", modelId: selected.id, modelName: selected.displayName };
    const prior = [...messages, user];
    setMessages([...prior, reply]); setDraft(""); setSending(true); setError("");
    const controller = new AbortController(); abort.current = controller;
    let answer = ""; let streamError = "";
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-nvidia-api-key": key }, body: JSON.stringify({ modelId: selected.id, messages: outgoing }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { message?: string }; throw new Error(data.message || "请求失败。"); }
      const reader = response.body?.getReader(); if (!reader) throw new Error("没有返回内容。");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const value = line.slice(5).trim(); if (!value || value === "[DONE]") continue;
          let event: { delta?: string; error?: string }; try { event = JSON.parse(value); } catch { continue; }
          if (event.error) streamError = event.error;
          answer += event.delta || "";
          const snapshot = answer;
          setMessages([...prior, { ...reply, content: snapshot }]);
        }
      }
      if (streamError) setError(streamError);
      if (!answer && !streamError) setError("模型没有返回可见回答，请换一个模型重试。");
    } catch (e) {
      setError(controller.signal.aborted ? "已停止生成，已保留当前内容。" : e instanceof Error ? e.message : "连接失败，请重试。");
    } finally {
      const finalMessages = answer ? [...prior, { ...reply, content: answer }] : prior;
      setMessages(finalMessages);
      try { await persist(finalMessages, selected.id); } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); }
      setSending(false); abort.current = null;
    }
  }
  return (
    <div className="flex h-dvh flex-col bg-[#e6eef3] text-[#1c2838]">
      <header className="flex items-center gap-3 border-b border-[#c9d5e0] bg-[#f7fafc] px-4 py-3">
        <div><h1 className="text-lg font-medium">多模型聊天</h1><p className="text-xs text-slate-500">同一会话共享上下文</p></div>
        <Link href="/" className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">返回模型配置</Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col bg-[#1c2838] p-3 text-[#e7eef4] sm:w-64">
          <button disabled={sending || switching} onClick={startNew} className="rounded-md bg-white/10 px-3 py-2 text-left text-sm hover:bg-white/20 disabled:opacity-50">＋ 新建对话</button>
          <p className="mt-5 text-xs text-slate-400">历史对话</p>
          {!saveHistory ? <p className="mt-3 text-xs text-slate-400">当前未保存记录，可在配置页设置开启。</p> : null}
          <div className="mt-2 flex-1 space-y-1 overflow-auto">
            {history.map((item) => <div key={item.id} className={`rounded-md p-2 text-sm ${item.id === id ? "bg-white/15" : "hover:bg-white/5"}`}>
              <button disabled={sending || switching} onClick={() => void openConversation(item)} className="block w-full truncate text-left">{item.title}</button>
              <div className="mt-1 flex gap-3 text-xs text-slate-400"><button disabled={sending || switching} onClick={() => void renameConversation(item)}>重命名</button><button disabled={sending || switching} onClick={() => void removeConversation(item)}>删除</button></div>
            </div>)}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[#c9d5e0] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2"><label htmlFor="model-search" className="text-sm">当前模型</label>
              <input id="model-search" aria-label="搜索模型" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索模型" className="w-32 rounded border border-slate-300 px-2 py-1 text-sm" />
              <select aria-label="选择聊天模型" disabled={sending || switching} value={modelId} onChange={(e) => void switchModel(e.target.value)} className="max-w-full rounded border border-slate-300 px-2 py-1 text-sm">
                {!selected && modelId ? <option value={modelId}>原模型不可用，请切换</option> : null}
                {sortBySpeed(models, benchmark.results).filter((m) => m.id === modelId || `${m.displayName} ${m.publisher}`.toLowerCase().includes(search.toLowerCase())).map((m) => <option value={m.id} key={m.id}>{m.displayName} · {speedLabel(m, benchmark.results)}</option>)}
              </select>
            </div>
            <p className="mt-2 text-xs text-slate-500">切换后，当前会话的相关历史会发送给新模型；思考内容不会共享。{omitted > 0 ? ` 本次将省略较早的 ${omitted} 条消息。` : ""}</p>
            <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">查看本次将发送的上下文</summary><div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{context.filter((m) => m.content).map((m, i) => <p key={i} className="mb-2"><b>{m.role === "user" ? "用户" : "模型"}：</b>{m.content}</p>)}</div></details>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
            {!messages.length ? <p className="mx-auto mt-16 max-w-xl text-center text-slate-500">开始一段对话。你可以随时切换模型，继续讨论同一个问题。</p> : null}
            {messages.map((m) => <div key={m.id} className={`mx-auto max-w-3xl rounded-lg p-4 ${m.role === "user" ? "bg-[#d7e6f8]" : "border border-slate-200 bg-white"}`}>
              <p className="mb-2 text-xs font-medium text-slate-500">{m.role === "user" ? "我" : m.modelName || m.modelId || "模型来源未知"}</p><div className="whitespace-pre-wrap break-words text-sm leading-7">{m.content || (sending && m.role === "assistant" ? "正在等待回答…" : "")}</div>
            </div>)}
          </div>
          <div className="border-t border-slate-200 bg-[#f7fafc] p-4">
            {error ? <p role="alert" className="mx-auto mb-2 max-w-3xl text-sm text-red-700">{error}</p> : null}
            <div className="mx-auto flex max-w-3xl gap-2"><textarea aria-label="输入消息" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder="输入消息，Enter 发送，Shift+Enter 换行" className="min-h-20 min-w-0 flex-1 resize-y rounded-md border border-slate-300 bg-white p-3 text-sm" />
              {sending ? <button onClick={() => abort.current?.abort()} className="self-end rounded-md bg-slate-700 px-4 py-2 text-sm text-white">停止</button> : <button onClick={() => void send()} disabled={!draft.trim() || switching} className="self-end rounded-md bg-[#1f4fd8] px-4 py-2 text-sm text-white disabled:opacity-50">发送</button>}
            </div><p className="mx-auto mt-2 max-w-3xl text-xs text-slate-500">{saveHistory ? "聊天记录保存在本机。" : "聊天记录未保存，刷新或关闭页面后会丢失。"} 模型输出可能不准确。</p>
          </div>
        </main>
      </div>
    </div>
  );
}
