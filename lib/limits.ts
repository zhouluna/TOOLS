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

export function finishesBeforeDeadline(abortMs: number, maxDurationSeconds: number, marginMs = 5_000): boolean {
  return abortMs + marginMs <= maxDurationSeconds * 1000 && maxDurationSeconds <= HOBBY_MAX_DURATION_SECONDS;
}
