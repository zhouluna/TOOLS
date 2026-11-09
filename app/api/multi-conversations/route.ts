import { getDb } from "@/lib/db";
import { readOwner } from "@/lib/chat";
import { json, live } from "@/lib/http";
import { listMulti, saveMulti, type MultiConversation, type MultiMessage } from "@/lib/multi-conversations";

export async function GET(request: Request) {
  await live();
  const owner = readOwner(request);
  return owner ? json({ conversations: listMulti(getDb(), owner) }) : json({ message: "需要本机身份标记。" }, 400);
}

export async function POST(request: Request) {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记。" }, 400);
  const input = await request.json().catch(() => null) as MultiConversation | null;
  if (!input || typeof input.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(input.id) ||
      typeof input.title !== "string" || !input.title.trim() || input.title.length > 80 ||
      typeof input.modelId !== "string" || input.modelId.length > 160 || !Array.isArray(input.messages) ||
      !input.messages.every((m: MultiMessage) => m && typeof m.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(m.id) &&
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length > 0 &&
        (m.modelId == null || typeof m.modelId === "string" && m.modelId.length <= 160) &&
        (m.modelName == null || typeof m.modelName === "string" && m.modelName.length <= 160))) {
    return json({ message: "会话数据不合法，未保存。" }, 400);
  }
  try { saveMulti(getDb(), owner, input); }
  catch (error) {
    if (error instanceof Error && error.message === "forbidden_conversation") return json({ message: "无权修改此会话。" }, 403);
    return json({ message: "会话保存失败，请重试。" }, 500);
  }
  return json({ ok: true });
}
