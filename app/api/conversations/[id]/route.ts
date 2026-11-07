import { readOwner } from "@/lib/chat";
import { deleteConversation, getConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { json, live } from "@/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记才能读取记录。" }, 400);
  const { id } = await context.params;
  const conversation = getConversation(getDb(), owner, id);
  if (!conversation) return json({ message: "没有这条会话。" }, 404);
  return json({ conversation });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记才能删除记录。" }, 400);
  const { id } = await context.params;
  const removed = deleteConversation(getDb(), owner, id);
  if (!removed) return json({ message: "没有这条会话。" }, 404);
  return json({ ok: true });
}
