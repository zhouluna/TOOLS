import { clampNumber, readApiKey, sanitizeMessages } from "@/lib/chat";
import { classifyNetworkError, classifyUpstream } from "@/lib/errors";
import { getDb, getModel } from "@/lib/db";
import { json, live } from "@/lib/http";
import { isAllowedUpstream } from "@/lib/parse-catalog";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { nvidiaFetch } from "@/lib/nvidia-http";

// Hobby ceiling. Streaming keeps the invocation alive, so this stays at the
// platform maximum instead of the short key-test budget.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  await live();
  const started = Date.now();
  if (!rateLimit(clientKey(request, "chat"), 30, 60 * 1000)) {
    return json({ code: "rate_limit", message: "本机转发太频繁。请稍后再发。" }, 429);
  }
  const apiKey = readApiKey(request);
  if (!apiKey) {
    return json({ code: "auth", message: "认证失败。检查 API Key，或重新输入后再试。" }, 401);
  }
  const body = (await request.json().catch(() => null)) as {
    modelId?: unknown;
    messages?: unknown;
    temperature?: unknown;
    topP?: unknown;
    maxTokens?: unknown;
  } | null;
  if (!body || typeof body.modelId !== "string") {
    return json({ code: "bad_request", message: "请求参数不被接受。" }, 400);
  }
  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return json({ code: "bad_request", message: "消息为空，或超出长度限制。" }, 400);
  }
  const model = getModel(getDb(), body.modelId);
  if (!model) return json({ code: "unavailable", message: "目录里没有这个模型。" }, 404);
  if (model.status === "offline") {
    return json({ code: "offline", message: "这个模型已下线，不能新建调用。" }, 409);
  }
  if (model.status === "suspected_offline") {
    return json(
      { code: "unavailable", message: "最近一次完整同步没有看到这个模型。先换一个，或等下次同步确认。" },
      409,
    );
  }
  if (model.status !== "chat_ready" || model.endpoint?.adapter !== "openai_chat") {
    return json({ code: "not_adapted", message: "这个免费端点还没有接入聊天。可以先看接口详情。" }, 409);
  }
  const endpointUrl = model.endpoint.url;
  const nvidiaModelId = model.endpoint.nvidiaModelId;
  if (!endpointUrl || !nvidiaModelId || !isAllowedUpstream(endpointUrl)) {
    return json({ code: "unconfirmed", message: "接口信息不完整，暂不能调用。" }, 409);
  }

  const payload: Record<string, unknown> = {
    model: nvidiaModelId,
    messages,
    stream: true,
  };
  const temperature = clampNumber(body.temperature, 0, 2);
  const topP = clampNumber(body.topP, 0, 1);
  const maxTokens = clampNumber(body.maxTokens, 1, 4096);
  if (temperature !== undefined) payload.temperature = temperature;
  if (topP !== undefined) payload.top_p = topP;
  if (maxTokens !== undefined) payload.max_tokens = maxTokens;

  let upstream: Response;
  try {
    upstream = await nvidiaFetch(endpointUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return json({ code: "network", message: "生成已停止。" }, 499);
    }
    console.info(
      JSON.stringify({
        event: "chat",
        modelId: model.id,
        category: "network",
        ms: Date.now() - started,
      }),
    );
    return json({ code: "network", message: `${classifyNetworkError(error)} 输入还在，可以手动重试。` }, 502);
  }

  if (!upstream.ok) {
    await upstream.text().catch(() => "");
    const classified = classifyUpstream(upstream.status, upstream.headers.get("retry-after"));
    console.info(
      JSON.stringify({
        event: "chat",
        modelId: model.id,
        category: classified.code,
        status: upstream.status,
        ms: Date.now() - started,
      }),
    );
    return json(classified, upstream.status);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const raw = await upstream.json().catch(() => null);
    const content = readCompletion(raw);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        if (content) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: content, reasoning: "" })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return streamResponse(stream);
  }

  return streamResponse(transformSse(upstream, request.signal));
}

function streamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function readCompletion(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: { message?: { content?: unknown } }[] }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function transformSse(upstream: Response, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = upstream.body?.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  return new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.close();
        return;
      }
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = translateLine(line);
            if (event) controller.enqueue(encoder.encode(event));
          }
        }
        if (buffer.trim()) {
          const event = translateLine(buffer);
          if (event) controller.enqueue(encoder.encode(event));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "网络中断。已保留已经生成的内容，可以手动重试。" })}\n\n`,
          ),
        );
        controller.close();
      }
    },
    cancel() {
      void reader?.cancel();
    },
  });
}

function translateLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return data === "[DONE]" ? "data: [DONE]\n\n" : null;
  try {
    const payload = JSON.parse(data) as {
      choices?: {
        delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }[];
      error?: { message?: unknown };
    };
    if (payload.error && typeof payload.error.message === "string") {
      return `data: ${JSON.stringify({ error: "生成中断。已保留已经写出的内容。" })}\n\n`;
    }
    const delta = payload.choices?.[0]?.delta;
    const content = typeof delta?.content === "string" ? delta.content : "";
    const reasoning =
      typeof delta?.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta?.reasoning === "string"
          ? delta.reasoning
          : "";
    if (!content && !reasoning) return null;
    return `data: ${JSON.stringify({ delta: content, reasoning })}\n\n`;
  } catch {
    return null;
  }
}
