import { getDb, getModel } from "@/lib/db";
import { json, live } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string[] }> },
): Promise<Response> {
  await live();
  const { id } = await context.params;
  const modelId = id.map((part) => decodeURIComponent(part)).join("/");
  const model = getModel(getDb(), modelId);
  if (!model) return json({ message: "目录里没有这个模型。" }, 404);
  return json({ model });
}
