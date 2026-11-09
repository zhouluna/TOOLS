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

const HOSTED_CATALOG_MESSAGE =
  "线上同步只拉取 NGC 免费端点列表（约数秒），保留已有接口；完整模型页抓取请在本机执行 npm run snapshot 后重新部署。";

/** Vercel cannot finish a full NGC page scrape inside one function. */
export function usesHostedSnapshot(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1";
}

export type SyncMode = "full" | "catalog";

export function syncStatus(): {
  state: "idle" | "running";
  progress: string;
  lastSuccessAt: string | null;
  lastRun: SyncRunView | null;
  mode: SyncMode;
  message?: string;
} {
  const database = getDb();
  const hosted = usesHostedSnapshot();
  return {
    state: state().running ? "running" : "idle",
    progress: state().progress,
    lastSuccessAt: lastSuccessAt(database),
    lastRun: latestSync(database),
    mode: hosted ? "catalog" : "full",
    message: hosted ? HOSTED_CATALOG_MESSAGE : undefined,
  };
}

/** Local / long-lived process: kick a full scrape in the background. */
export function triggerSync(): { started: boolean; message?: string } {
  if (usesHostedSnapshot()) {
    return { started: false, message: HOSTED_CATALOG_MESSAGE };
  }
  if (globalSync.endpointSync) return { started: false };
  const current = runSync("full").finally(() => {
    globalSync.endpointSync = null;
  });
  globalSync.endpointSync = current;
  return { started: true };
}

/**
 * Hosted (Vercel): await a catalog-list sync inside the request so the work
 * finishes before the function returns. Full HTML scrapes stay off-platform.
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
  if (globalSync.endpointSync) {
    return { started: false, ok: false, message: "同步仍在进行。" };
  }
  const current = runSync("catalog");
  globalSync.endpointSync = current.finally(() => {
    globalSync.endpointSync = null;
  });
  await current;
  const last = latestSync(getDb());
  const ok = last?.result === "success";
  return {
    started: true,
    ok,
    message: ok ? HOSTED_CATALOG_MESSAGE : (last?.error ?? "同步失败"),
  };
}

async function runSync(mode: SyncMode): Promise<void> {
  const database = getDb();
  const startedAt = new Date().toISOString();
  const runId = startSyncRun(database, startedAt);
  state().running = true;
  state().progress = mode === "catalog" ? "开始目录列表同步" : "开始同步";
  let counts: ApplyCounts | undefined;
  try {
    const models =
      mode === "catalog"
        ? await discoverCatalogModels({
            onProgress: (message) => {
              state().progress = message;
            },
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
    finishSyncRun(database, runId, {
      at: new Date().toISOString(),
      result: "success",
      counts,
      complete: mode === "full",
    });
    state().progress = mode === "catalog" ? "目录列表同步完成" : "同步完成";
    console.info(
      JSON.stringify({
        event: "sync",
        result: "success",
        mode,
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
