import assert from "node:assert/strict";
import test from "node:test";
import { discoverCatalogModels, discoverFreeModels } from "../lib/nvidia-fetch";

test("catalog discover maps Free Endpoint rows without scraping model pages", async () => {
  const pages: unknown[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    pages.push(url);
    assert.match(url, /api\.ngc\.nvidia\.com/);
    assert.doesNotMatch(url, /build\.nvidia\.com/);
    const body = {
      resultPageTotal: 1,
      results: [
        {
          groupValue: "ENDPOINT",
          resources: [
            {
              name: "demo-chat",
              displayName: "Demo Chat",
              description: "A free demo.",
              labels: [
                { key: "publisher", values: ["acme"] },
                { key: "other", values: ["Free Endpoint", "chat"] },
              ],
              attributes: [{ key: "logo", value: "https://assets.ngc.nvidia.com/demo.png" }],
            },
            {
              name: "paid-only",
              displayName: "Paid",
              labels: [{ key: "publisher", values: ["acme"] }],
            },
          ],
        },
      ],
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const models = await discoverCatalogModels({ fetchImpl });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "acme/demo-chat");
  assert.equal(models[0].endpoint, null);
  assert.equal(models[0].category, "chat");
  assert.equal(pages.length, 1);
});

test("discoverFreeModels respects scrape deadline and still returns catalog rows", async () => {
  let htmlHits = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.ngc.nvidia.com")) {
      const body = {
        resultPageTotal: 1,
        results: [
          {
            groupValue: "ENDPOINT",
            resources: [
              {
                name: "a",
                displayName: "A",
                labels: [
                  { key: "publisher", values: ["acme"] },
                  { key: "other", values: ["Free Endpoint"] },
                ],
              },
              {
                name: "b",
                displayName: "B",
                labels: [
                  { key: "publisher", values: ["acme"] },
                  { key: "other", values: ["Free Endpoint"] },
                ],
              },
            ],
          },
        ],
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    htmlHits += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  };

  const models = await discoverFreeModels({
    fetchImpl,
    deadlineMs: 0,
    pageTimeoutMs: 50,
    concurrency: 2,
  });
  assert.equal(models.length, 2);
  assert.equal(models.every((model) => model.endpoint === null), true);
  assert.equal(htmlHits, 0);
});
