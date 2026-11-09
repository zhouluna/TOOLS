/**
 * Durations for routes that call NVIDIA.
 * The numeric `export const maxDuration` in each route file must match the
 * constants here. Next.js reads that literal when it deploys the function.
 * Hobby Fluid Compute allows at most 300s. The abort must finish first so the
 * handler can still write a JSON body.
 */
export const HOBBY_MAX_DURATION_SECONDS = 300;

export const KEY_TEST_MAX_DURATION_SECONDS = 60;
export const KEY_TEST_ABORT_MS = 50_000;
export const KEY_TEST_CLIENT_ABORT_MS = 58_000;

export const CHAT_MAX_DURATION_SECONDS = 300;

/**
 * Hosted sync may scrape model pages until near the Hobby ceiling.
 * Client abort must finish before the function hard-kill so JSON can return.
 */
export const SYNC_MAX_DURATION_SECONDS = 300;
export const SYNC_CLIENT_ABORT_MS = 290_000;
/** Leave headroom inside the function for apply + JSON after scrapes stop. */
export const SYNC_HOSTED_SCRAPE_BUDGET_MS = 270_000;
export const SYNC_HOSTED_PAGE_TIMEOUT_MS = 12_000;
export const SYNC_HOSTED_CONCURRENCY = 6;

export function finishesBeforeDeadline(abortMs: number, maxDurationSeconds: number, marginMs = 5_000): boolean {
  return abortMs + marginMs <= maxDurationSeconds * 1000 && maxDurationSeconds <= HOBBY_MAX_DURATION_SECONDS;
}
