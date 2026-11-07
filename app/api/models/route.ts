import { getDb, listModels, listPublishers, lastSuccessAt } from "@/lib/db";
import { CATEGORIES, MODEL_STATUSES } from "@/lib/types";
import { json, live } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  await live();
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const publisher = url.searchParams.get("publisher") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return json({ message: "没有这个分类。" }, 400);
  }
  if (status && !MODEL_STATUSES.includes(status as (typeof MODEL_STATUSES)[number])) {
    return json({ message: "没有这个状态。" }, 400);
  }
  const database = getDb();
  return json({
    models: listModels(database, {
      q: q || undefined,
      category: category || undefined,
      status: status || undefined,
      publisher: publisher || undefined,
    }),
    publishers: listPublishers(database),
    syncedAt: lastSuccessAt(database),
  });
}
