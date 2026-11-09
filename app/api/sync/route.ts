import { clientKey, rateLimit } from "@/lib/rate-limit";
import { awaitHostedCatalogSync, syncStatus, triggerSync, usesHostedSnapshot } from "@/lib/sync";
import { json, live } from "@/lib/http";

// Keep literal equal to SYNC_MAX_DURATION_SECONDS in lib/limits.ts.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  await live();
  if (!rateLimit(clientKey(request, "sync"), 6, 10 * 60 * 1000)) {
    return json({ message: "同步太频繁。请等几分钟再试。" }, 429);
  }

  if (usesHostedSnapshot()) {
    const result = await awaitHostedCatalogSync();
    const status = syncStatus();
    return json({
      ...status,
      started: result.started,
      ok: result.ok,
      awaited: true,
      message: result.message ?? status.message,
    });
  }

  const { started } = triggerSync();
  return json({ ...syncStatus(), started });
}
