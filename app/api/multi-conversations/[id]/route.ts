import { getDb } from "@/lib/db";
import { readOwner } from "@/lib/chat";
import { json, live } from "@/lib/http";
import { deleteMulti, getMulti } from "@/lib/multi-conversations";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记。" }, 400);
  const { id } = await context.params;
  const conversation = getMulti(getDb(), owner, id);
  return conversation ? json({ conversation }) : json({ message: "没有这条会话。" }, 404);
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  await live();
  const owner = readOwner(request);
  if (!owner) return json({ message: "需要本机身份标记。" }, 400);
  const { id } = await context.params;
  return deleteMulti(getDb(), owner, id) ? json({ ok: true }) : json({ message: "没有这条会话。" }, 404);
}
