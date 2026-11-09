import { readApiKey } from "@/lib/chat";
import { classifyNetworkError, classifyUpstream, networkReason } from "@/lib/errors";
import { getDb, getModel, listModels } from "@/lib/db";
import { json, live } from "@/lib/http";
import { KEY_TEST_ABORT_MS } from "@/lib/limits";
import { isAllowedUpstream } from "@/lib/parse-catalog";
import { isKeyTestModel, pickProbeModel } from "@/lib/probe-model";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { nvidiaFetch } from "@/lib/nvidia-http";

// Keep this literal equal to KEY_TEST_MAX_DURATION_SECONDS. The abort below
// fires 10s earlier so a timeout still returns JSON.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  await live();
  const started = Date.now();
  if (!rateLimit(clientKey(request, "key-test"), 8, 10 * 60 * 1000)) {
    return json({ ok: false, code: "rate_limit", message: "测试太频繁。请稍后再试。" }, 429);
  }
  const apiKey = readApiKey(request);
  if (!apiKey) {
    return json({ ok: false, code: "auth", message: "认证失败。检查 API Key，或重新输入后再试。" }, 401);
  }
  const body = (await request.json().catch(() => null)) as { modelId?: unknown } | null;
  const requestedId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const requested = requestedId ? getModel(getDb(), requestedId) : null;
  if (requestedId && !isKeyTestModel(requested)) {
    return json(
      {
        ok: false,
        code: "not_adapted",
        reason: "model_not_chat_ready",
        message: "这个模型不能用来测试连接。请改选一个可聊天模型，或不选模型以使用较快的探针。",
      },
      409,
    );
  }
  const model = requested && isKeyTestModel(requested)
    ? requested
    : pickProbeModel(listModels(getDb(), { status: "chat_ready" }));
  if (!model || !isKeyTestModel(model)) {
    return json(
      {
        ok: false,
        code: "not_adapted",
        reason: "no_chat_model",
        message: "还没有可用来测试的聊天模型。目录里需要至少一个已确认的聊天接口。",
      },
      409,
    );
  }
  if (!isAllowedUpstream(model.endpoint.url)) {
    return json(
      { ok: false, code: "unconfirmed", message: "测试地址不在已确认的 NVIDIA 接口里。" },
      409,
    );
  }

  let upstream: Response;
  try {
    upstream = await nvidiaFetch(model.endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.endpoint.nvidiaModelId,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(KEY_TEST_ABORT_MS),
    });
  } catch (error) {
    const reason = networkReason(error);
    logKeyTest(model, reason, started);
    return json(
      {
        ok: false,
        code: "network",
        reason,
        modelId: model.id,
        message: `${classifyNetworkError(error)} 这不能说明 Key 无效。`,
      },
      502,
    );
  }
  if (!upstream.ok) {
    await upstream.text().catch(() => "");
    const classified = classifyUpstream(upstream.status, upstream.headers.get("retry-after"));
    logKeyTest(model, classified.code, started);
    return json({ ok: false, ...classified, modelId: model.id }, upstream.status);
  }
  await upstream.text().catch(() => "");
  logKeyTest(model, "ok", started);
  return json({
    ok: true,
    modelId: model.id,
    message: `已用 ${model.displayName} 完成一次短请求。这只说明当时这个接口可用。`,
  });
}

function logKeyTest(model: { id: string }, category: string, started: number): void {
  console.info(
    JSON.stringify({
      event: "key-test",
      modelId: model.id,
      category,
      ms: Date.now() - started,
    }),
  );
}
