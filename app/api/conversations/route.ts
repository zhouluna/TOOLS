import { readOwner } from "@/lib/chat";
import { deleteAllConversations, listConversations, saveConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { json, live } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记才能读取记录。" }, 400);
  return json({ conversations: listConversations(getDb(), owner) });
}

export async function POST(request: Request): Promise<Response> {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记才能保存记录。" }, 400);
  if (!rateLimit(clientKey(request, "history"), 60, 10 * 60 * 1000)) {
    return json({ message: "记录保存太频繁。" }, 429);
  }
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    title?: unknown;
    modelId?: unknown;
    messages?: unknown;
  } | null;
  if (!body || typeof body.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)) {
    return json({ message: "会话编号不正确。" }, 400);
  }
  if (typeof body.modelId !== "string" || body.modelId.length > 160) {
    return json({ message: "模型编号不正确。" }, 400);
  }
  if (!Array.isArray(body.messages)) return json({ message: "消息格式不正确。" }, 400);
  try {
    saveConversation(getDb(), owner, {
      id: body.id,
      title: typeof body.title === "string" ? body.title : "未命名对话",
      modelId: body.modelId,
      messages: body.messages.filter(
        (message): message is { id: string; role: string; content: string } =>
          Boolean(message) &&
          typeof message === "object" &&
          typeof (message as { id?: unknown }).id === "string" &&
          typeof (message as { role?: unknown }).role === "string" &&
          typeof (message as { content?: unknown }).content === "string",
      ),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden_conversation") {
      return json({ message: "不能修改别人的会话。" }, 403);
    }
    throw error;
  }
  return json({ ok: true });
}

export async function DELETE(request: Request): Promise<Response> {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记才能删除记录。" }, 400);
  const removed = deleteAllConversations(getDb(), owner);
  return json({ removed });
}
