import { clientKey, rateLimit } from "@/lib/rate-limit";
import { syncStatus, triggerSync } from "@/lib/sync";
import { json, live } from "@/lib/http";

export async function POST(request: Request): Promise<Response> {
  await live();
  if (!rateLimit(clientKey(request, "sync"), 6, 10 * 60 * 1000)) {
    return json({ message: "同步太频繁。请等几分钟再试。" }, 429);
  }
  const { started } = triggerSync();
  return json({ ...syncStatus(), started });
}
