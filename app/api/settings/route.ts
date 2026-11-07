import { getDb, getSetting, setSetting } from "@/lib/db";
import { readOwner } from "@/lib/chat";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { json, live } from "@/lib/http";

export async function GET(): Promise<Response> {
  await live();
  const database = getDb();
  return json({
    syncIntervalHours: Number(getSetting(database, "sync_interval_hours", "24")),
  });
}

export async function POST(request: Request): Promise<Response> {
  await live();
  if (!readOwner(request)) {
    return json({ message: "需要本机身份标记才能保存设置。" }, 400);
  }
  if (!rateLimit(clientKey(request, "settings"), 20, 10 * 60 * 1000)) {
    return json({ message: "设置保存太频繁。" }, 429);
  }
  const body = (await request.json().catch(() => null)) as { syncIntervalHours?: unknown } | null;
  const hours = body?.syncIntervalHours;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 168) {
    return json({ message: "同步间隔需要是 1 到 168 之间的小时数。" }, 400);
  }
  setSetting(getDb(), "sync_interval_hours", String(hours));
  return json({ syncIntervalHours: hours });
}
