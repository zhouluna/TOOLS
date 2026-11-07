import { readApiKey } from "@/lib/chat";
import { classifyUpstream } from "@/lib/errors";
import { getDb, getModel, listModels } from "@/lib/db";
import { json, live } from "@/lib/http";
import { isAllowedUpstream } from "@/lib/parse-catalog";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request): Promise<Response> {
  await live();
  if (!rateLimit(clientKey(request, "key-test"), 8, 10 * 60 * 1000)) {
    return json({ code: "rate_limit", message: "测试太频繁。请稍后再试。" }, 429);
  }
  const apiKey = readApiKey(request);
  if (!apiKey) {
    return json({ code: "auth", message: "认证失败。检查 API Key，或重新输入后再试。" }, 401);
  }
  const body = (await request.json().catch(() => null)) as { modelId?: unknown } | null;
  const requested = typeof body?.modelId === "string" ? body.modelId : "";
  const model =
    (requested ? getModel(getDb(), requested) : null) ??
    listModels(getDb(), { status: "chat_ready" })[0] ??
    null;
  if (!model || model.status !== "chat_ready" || !model.endpoint?.url || !model.endpoint.nvidiaModelId) {
    return json({ code: "not_adapted", message: "还没有可用来测试的聊天模型。先同步目录。" }, 409);
  }
  if (!isAllowedUpstream(model.endpoint.url)) {
    return json({ code: "unconfirmed", message: "测试地址不在已确认的 NVIDIA 接口里。" }, 409);
  }
  let upstream: Response;
  try {
    upstream = await fetch(model.endpoint.url, {
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
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return json({ code: "network", message: "网络失败或超时。这只能说明当时连不上，不能说明 Key 无效。" }, 502);
  }
  if (!upstream.ok) {
    await upstream.text().catch(() => "");
    const classified = classifyUpstream(upstream.status, upstream.headers.get("retry-after"));
    return json({ ...classified, modelId: model.id }, upstream.status);
  }
  await upstream.text().catch(() => "");
  return json({
    ok: true,
    modelId: model.id,
    message: `已用 ${model.displayName} 完成一次短请求。这只说明当时这个接口可用。`,
  });
}
