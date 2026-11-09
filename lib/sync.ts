import { discoverCatalogModels, discoverFreeModels } from "@/lib/nvidia-fetch";
import {
  applyDiscovered,
  finishSyncRun,
  getDb,
  lastSuccessAt,
  latestSync,
  startSyncRun,
  type ApplyCounts,
} from "@/lib/db";
import {
  SYNC_HOSTED_CONCURRENCY,
  SYNC_HOSTED_PAGE_TIMEOUT_MS,
  SYNC_HOSTED_SCRAPE_BUDGET_MS,
} from "@/lib/limits";
import type { SyncRunView } from "@/lib/types";

type SyncState = {
  running: boolean;
  progress: string;
};

const globalSync = globalThis as unknown as {
  endpointSync?: Promise<void> | null;
  endpointSyncState?: SyncState;
};

function state(): SyncState {
  if (!globalSync.endpointSyncState) {
    globalSync.endpointSyncState = { running: false, progress: "" };
  }
  return globalSync.endpointSyncState;
}

const HOSTED_SYNC_MESSAGE =
  "线上同步会刷新全部免费模型目录，并在时限内尽量核对模型页接口；未扫到的保留已有接口。完整快照仍可用本机 npm run snapshot 后重新部署。";

/** Vercel serverless: no durable background loop; sync must finish in-request. */
export function usesHostedSnapshot(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1";
}

export type SyncMode = "full" | "catalog" | "hosted";

function activelyRunning(): boolean {
  return Boolean(globalSync.endpointSync) && state().running;
}

/** Drop a stuck in-memory lock left by a killed warm isolate. */
function clearStaleLock(): void {
  if (globalSync.endpointSync && !state().running) {
    globalSync.endpointSync = null;
  }
  if (state().running && !globalSync.endpointSync) {
    state().running = false;
    state().progress = "";
  }
}

export function syncStatus(): {
  state: "idle" | "running";
  progress: string;
  lastSuccessAt: string | null;
  lastRun: SyncRunView | null;
  mode: SyncMode;
  message?: string;
} {
  clearStaleLock();
  const database = getDb();
  const hosted = usesHostedSnapshot();
  return {
    // Only report running when a live promise holds the lock — avoids a gray
    // 「同步目录」 button after a warm instance kept running=true without work.
    state: activelyRunning() ? "running" : "idle",
    progress: state().progress,
    lastSuccessAt: lastSuccessAt(database),
    lastRun: latestSync(database),
    mode: hosted ? "hosted" : "full",
    message: hosted ? HOSTED_SYNC_MESSAGE : undefined,
  };
}

/** Local / long-lived process: kick a full scrape in the background. */
export function triggerSync(): { started: boolean; message?: string } {
  if (usesHostedSnapshot()) {
    return { started: false, message: HOSTED_SYNC_MESSAGE };
  }
  clearStaleLock();
  if (globalSync.endpointSync) return { started: false };
  const current = runSync("full").finally(() => {
    globalSync.endpointSync = null;
  });
  globalSync.endpointSync = current;
  return { started: true };
}

/**
 * Hosted (Vercel): await a free-model refresh inside the request.
 * Scrapes model pages until the Hobby budget, then applies the full catalog
 * list (unscraped rows keep stored endpoints via applyDiscovered).
 */
export async function awaitHostedCatalogSync(): Promise<{
  started: boolean;
  ok: boolean;
  message?: string;
}> {
  if (!usesHostedSnapshot()) {
    const { started } = triggerSync();
    return { started, ok: started };
  }
  clearStaleLock();
  if (globalSync.endpointSync) {
    // Wait briefly for an in-flight sync; if it hangs, clear and continue.
    try {
      await Promise.race([
        globalSync.endpointSync,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("sync_wait_timeout")), 8_000);
        }),
      ]);
    } catch {
      globalSync.endpointSync = null;
      state().running = false;
      state().progress = "";
    }
    if (globalSync.endpointSync) {
      return { started: false, ok: false, message: "同步仍在进行，请稍后再试。" };
    }
  }
  const current = runSync("hosted");
  globalSync.endpointSync = current.finally(() => {
    globalSync.endpointSync = null;
  });
  await current;
  const last = latestSync(getDb());
  const ok = last?.result === "success";
  return {
    started: true,
    ok,
    message: ok ? HOSTED_SYNC_MESSAGE : (last?.error ?? "同步失败"),
  };
}

async function runSync(mode: SyncMode): Promise<void> {
  const database = getDb();
  const startedAt = new Date().toISOString();
  const runId = startSyncRun(database, startedAt);
  state().running = true;
  state().progress =
    mode === "catalog" ? "开始目录列表同步" : mode === "hosted" ? "开始刷新免费模型" : "开始同步";
  let counts: ApplyCounts | undefined;
  try {
    const models =
      mode === "catalog"
        ? await discoverCatalogModels({
            onProgress: (message) => {
              state().progress = message;
            },
          })
        : mode === "hosted"
          ? await discoverFreeModels({
              onProgress: (message) => {
                state().progress = message;
              },
              deadlineMs: SYNC_HOSTED_SCRAPE_BUDGET_MS,
              pageTimeoutMs: SYNC_HOSTED_PAGE_TIMEOUT_MS,
              concurrency: SYNC_HOSTED_CONCURRENCY,
            })
          : await discoverFreeModels({
              onProgress: (message) => {
                state().progress = message;
              },
            });
    if (models.length === 0) {
      throw new Error("empty_catalog");
    }
    counts = applyDiscovered(database, models, { mode: "sync", at: new Date().toISOString() });
    const scraped = models.filter((model) => model.endpoint?.url).length;
    const complete = mode === "full" || (mode === "hosted" && scraped === models.length);
    finishSyncRun(database, runId, {
      at: new Date().toISOString(),
      result: "success",
      counts,
      complete,
    });
    state().progress =
      mode === "catalog"
        ? "目录列表同步完成"
        : mode === "hosted"
          ? `免费模型已刷新（核对接口 ${scraped}/${models.length}）`
          : "同步完成";
    console.info(
      JSON.stringify({
        event: "sync",
        result: "success",
        mode,
        scraped,
        total: models.length,
        added: counts.added,
        updated: counts.updated,
        suspected: counts.suspected,
        offlined: counts.offlined,
      }),
    );
  } catch (error) {
    const category = error instanceof Error ? error.message.slice(0, 80) : "sync_failed";
    finishSyncRun(database, runId, {
      at: new Date().toISOString(),
      result: "failed",
      counts,
      error: category,
      complete: false,
    });
    state().progress = "同步失败，已保留上次目录";
    console.info(JSON.stringify({ event: "sync", result: "failed", mode, category }));
  } finally {
    state().running = false;
  }
}

export function ensureScheduledSync(intervalHours: number): void {
  // Serverless has no durable background loop; skip auto-scrape on Vercel.
  if (usesHostedSnapshot()) return;
  const database = getDb();
  const latest = lastSuccessAt(database);
  if (!latest) {
    triggerSync();
    return;
  }
  const age = Date.now() - new Date(latest).getTime();
  if (age > intervalHours * 60 * 60 * 1000) triggerSync();
}
