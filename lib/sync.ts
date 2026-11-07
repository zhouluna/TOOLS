import { discoverFreeModels } from "@/lib/nvidia-fetch";
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

export function syncStatus(): {
  state: "idle" | "running";
  progress: string;
  lastSuccessAt: string | null;
  lastRun: SyncRunView | null;
} {
  const database = getDb();
  return {
    state: state().running ? "running" : "idle",
    progress: state().progress,
    lastSuccessAt: lastSuccessAt(database),
    lastRun: latestSync(database),
  };
}

export function triggerSync(): { started: boolean } {
  if (globalSync.endpointSync) return { started: false };
  const current = runSync().finally(() => {
    globalSync.endpointSync = null;
  });
  globalSync.endpointSync = current;
  return { started: true };
}

async function runSync(): Promise<void> {
  const database = getDb();
  const startedAt = new Date().toISOString();
  const runId = startSyncRun(database, startedAt);
  state().running = true;
  state().progress = "开始同步";
  let counts: ApplyCounts | undefined;
  try {
    const models = await discoverFreeModels({
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
      complete: true,
    });
    state().progress = "同步完成";
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
    console.info(JSON.stringify({ event: "sync", result: "failed", category }));
  } finally {
    state().running = false;
  }
}

export function ensureScheduledSync(intervalHours: number): void {
  const database = getDb();
  const latest = lastSuccessAt(database);
  if (!latest) {
    triggerSync();
    return;
  }
  const age = Date.now() - new Date(latest).getTime();
  if (age > intervalHours * 60 * 60 * 1000) triggerSync();
}
