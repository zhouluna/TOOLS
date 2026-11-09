import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classifyNetworkError, networkReason } from "../lib/errors";
import {
  CHAT_MAX_DURATION_SECONDS,
  finishesBeforeDeadline,
  HOBBY_MAX_DURATION_SECONDS,
  KEY_TEST_ABORT_MS,
  KEY_TEST_CLIENT_ABORT_MS,
  KEY_TEST_MAX_DURATION_SECONDS,
} from "../lib/limits";
import { statusFor } from "../lib/parse-catalog";
import { pickProbeModel, probeRank, resolveKeyTestModel, type ProbeCandidate } from "../lib/probe-model";
import { triggerSync, usesHostedSnapshot } from "../lib/sync";
import type { DiscoveredModel, ModelView } from "../lib/types";

function candidate(
  id: string,
  nvidiaModelId: string | null,
  status: ProbeCandidate["status"] = "chat_ready",
): ProbeCandidate {
  return {
    id,
    displayName: id,
    status,
    endpoint: nvidiaModelId
      ? {
          url: "https://integrate.api.nvidia.com/v1/chat/completions",
          nvidiaModelId,
          adapter: "openai_chat",
        }
      : null,
  };
}

test("key-test abort finishes before the function deadline", () => {
  assert.equal(KEY_TEST_MAX_DURATION_SECONDS, 60);
  assert.equal(KEY_TEST_ABORT_MS, 50_000);
  assert.equal(KEY_TEST_CLIENT_ABORT_MS, 58_000);
  assert.equal(CHAT_MAX_DURATION_SECONDS, HOBBY_MAX_DURATION_SECONDS);
  assert.equal(finishesBeforeDeadline(KEY_TEST_ABORT_MS, KEY_TEST_MAX_DURATION_SECONDS), true);
  assert.equal(KEY_TEST_ABORT_MS < KEY_TEST_CLIENT_ABORT_MS, true);
  assert.equal(KEY_TEST_CLIENT_ABORT_MS < KEY_TEST_MAX_DURATION_SECONDS * 1000, true);

  const keyRoute = fs.readFileSync(path.join(process.cwd(), "app/api/key/test/route.ts"), "utf8");
  const chatRoute = fs.readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  assert.match(keyRoute, /export const maxDuration = 60;/);
  assert.match(keyRoute, /AbortSignal\.timeout\(KEY_TEST_ABORT_MS\)/);
  assert.match(chatRoute, /export const maxDuration = 300;/);
});

test("classifies an aborted NVIDIA wait as a timeout", () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.equal(networkReason(timeout), "timeout");
  assert.match(classifyNetworkError(timeout), /超时/);
  assert.equal(networkReason(Object.assign(new Error("connect"), { code: "UND_ERR_CONNECT_TIMEOUT" })), "connect");
  assert.equal(networkReason(Object.assign(new Error("dns"), { code: "ENOTFOUND" })), "dns");
  const wrapped = new Error("fetch failed", { cause: timeout });
  assert.equal(networkReason(wrapped), "timeout");
});

test("unspecified key test prefers the small bolt model over the first alphabetical one", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/catalog-snapshot.json"), "utf8"),
  ) as { models: DiscoveredModel[] };
  const models: ModelView[] = snapshot.models.map((model) => ({
    ...model,
    status: statusFor(model.endpoint),
    firstSeenAt: "2026-11-06T00:00:00.000Z",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
  }));
  const picked = resolveKeyTestModel(null, models);
  assert.ok(picked);
  assert.equal(picked.endpoint?.nvidiaModelId, "nvidia/nemotron-3.5-bolt-e4b");
  const flash = candidate("deepseek-ai/deepseek-v4.1-flash", "deepseek-ai/deepseek-v4.1-flash");
  assert.ok(probeRank(picked) < probeRank(flash));
  const deepseek = models.find((model) => model.id === "deepseek-ai/deepseek-v4.1-flash") ?? null;
  assert.equal(resolveKeyTestModel(deepseek, models)?.id, "deepseek-ai/deepseek-v4.1-flash");
  assert.equal(pickProbeModel([candidate("nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-ultra-550b-a55b")])?.id, "nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(pickProbeModel([candidate("nvidia/embed", null, "pending_adapt")]), null);
});

test("hosted sync stays on the snapshot", () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    assert.equal(usesHostedSnapshot(), true);
    assert.equal(triggerSync().started, false);
    assert.match(triggerSync().message ?? "", /快照/);
    const scheduler = fs.readFileSync(path.join(process.cwd(), "lib/sync.ts"), "utf8");
    assert.match(scheduler, /export function ensureScheduledSync[\s\S]*if \(usesHostedSnapshot\(\)\) return;/);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
