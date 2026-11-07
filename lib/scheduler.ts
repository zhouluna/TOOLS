import { getSetting, getDb } from "@/lib/db";
import { ensureScheduledSync } from "@/lib/sync";

const globalScheduler = globalThis as unknown as { endpointScheduler?: boolean };

export function startScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalScheduler.endpointScheduler) return;
  globalScheduler.endpointScheduler = true;
  const tick = () => {
    try {
      const hours = Number(getSetting(getDb(), "sync_interval_hours", "24"));
      const interval = Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : 24;
      ensureScheduledSync(interval);
    } catch (error) {
      const category = error instanceof Error ? error.name : "scheduler";
      console.info(JSON.stringify({ event: "scheduler", category }));
    }
  };
  tick();
  setInterval(tick, 15 * 60 * 1000);
}
