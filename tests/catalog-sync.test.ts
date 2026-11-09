import assert from "node:assert/strict";
import test from "node:test";
import { discoverCatalogModels } from "../lib/nvidia-fetch";

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
