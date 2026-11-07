import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, applyDiscovered, listModels } from "../lib/db";
import { classifyUpstream } from "../lib/errors";
import { extractEndpoint, statusFor, categoryFromLabels } from "../lib/parse-catalog";
import type { DiscoveredModel } from "../lib/types";

const chatHtml = `
request = { ...request, model: "nvidia/nemotron-3.5-bolt-e4b" };
invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
"title":"NVIDIA NIM API for nvidia/nemotron-3.5-bolt-e4b"
`;

const embedHtml = `
"servers":[{"url":"https://integrate.api.nvidia.com/v1"}],"paths":{"/embeddings":{"post":{}}}
"model": "nvidia/nemotron-3-embed-1b"
`;

test("extracts a confirmed chat endpoint without guessing unrelated ids", () => {
  const endpoint = extractEndpoint(chatHtml, "nvidia", "nemotron-3.5-bolt-e4b", "2026-11-06T00:00:00.000Z");
  assert.ok(endpoint);
  assert.equal(endpoint?.nvidiaModelId, "nvidia/nemotron-3.5-bolt-e4b");
  assert.equal(endpoint?.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(statusFor(endpoint), "chat_ready");
  assert.equal(endpoint?.params.includes("messages"), true);
  assert.equal(endpoint?.url?.includes("nvapi"), false);
});

test("extracts an embedding url and leaves it pending adaptation", () => {
  const endpoint = extractEndpoint(embedHtml, "nvidia", "nemotron-3-embed-1b", "2026-11-06T00:00:00.000Z");
  assert.equal(endpoint?.url, "https://integrate.api.nvidia.com/v1/embeddings");
  assert.equal(statusFor(endpoint), "pending_adapt");
});

test("does not treat a loose name mention as a model id", () => {
  const html = `model: "other/completely-different" https://integrate.api.nvidia.com/v1/chat/completions`;
  const endpoint = extractEndpoint(html, "nvidia", "nemotron-3.5-bolt-e4b", "2026-11-06T00:00:00.000Z");
  assert.equal(endpoint?.nvidiaModelId, null);
  assert.equal(statusFor(endpoint), "unconfirmed");
});

test("categories come from official labels", () => {
  assert.equal(categoryFromLabels(["Chat", "Free Endpoint"]), "chat");
  assert.equal(categoryFromLabels(["reranking"]), "rerank");
  assert.equal(categoryFromLabels(["Biology"]), "other");
});

test("classifies upstream failures", () => {
  assert.equal(classifyUpstream(401, null).code, "auth");
  assert.equal(classifyUpstream(403, null).code, "forbidden");
  assert.equal(classifyUpstream(429, "12").retryAfterSeconds, 12);
  assert.equal(classifyUpstream(404, null).code, "unavailable");
  assert.equal(classifyUpstream(400, null).code, "bad_request");
});

function sample(id: string, name: string): DiscoveredModel {
  return {
    id,
    name,
    displayName: name,
    publisher: "nvidia",
    summary: "sample",
    category: "chat",
    labels: ["Chat", "Free Endpoint"],
    pageUrl: `https://build.nvidia.com/nvidia/${name}`,
    logoUrl: null,
    freeSource: "NVIDIA 目录标签 Free Endpoint",
    endpoint: {
      method: "POST",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      nvidiaModelId: id,
      adapter: "openai_chat",
      confirmStatus: "confirmed",
      source: "test",
      confirmedAt: "2026-11-06T00:00:00.000Z",
      params: ["model", "messages"],
    },
  };
}

test("keeps the previous catalog when a model disappears, then confirms offline", () => {
  const database = openDatabase(":memory:");
  applyDiscovered(database, [sample("nvidia/one", "one"), sample("nvidia/two", "two")], {
    mode: "sync",
    at: "2026-11-06T00:00:00.000Z",
  });
  applyDiscovered(database, [sample("nvidia/one", "one")], {
    mode: "sync",
    at: "2026-11-07T00:00:00.000Z",
  });
  const firstMiss = listModels(database, {}).find((model) => model.id === "nvidia/two");
  assert.equal(firstMiss?.status, "suspected_offline");
  applyDiscovered(database, [sample("nvidia/one", "one")], {
    mode: "sync",
    at: "2026-11-08T00:00:00.000Z",
  });
  const secondMiss = listModels(database, {}).find((model) => model.id === "nvidia/two");
  assert.equal(secondMiss?.status, "offline");
  assert.equal(listModels(database, {}).length, 2);
});

test("search treats quotes as text instead of widening the query", () => {
  const database = openDatabase(":memory:");
  applyDiscovered(database, [sample("nvidia/alpha", "alpha")], {
    mode: "seed",
    at: "2026-11-06T00:00:00.000Z",
  });
  const injected = listModels(database, { q: "%' OR '1'='1" });
  assert.equal(injected.length, 0);
  assert.equal(listModels(database, { q: "alpha" }).length, 1);
});
