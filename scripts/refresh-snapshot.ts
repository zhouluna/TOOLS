import fs from "node:fs";
import path from "node:path";
import { discoverFreeModels } from "../lib/nvidia-fetch";

async function main(): Promise<void> {
  const models = await discoverFreeModels({
    onProgress: (message) => {
      console.log(message);
    },
  });
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    models,
  };
  const directory = path.join(process.cwd(), "data");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "catalog-snapshot.json");
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
  const ready = models.filter(
    (model) => model.endpoint?.adapter === "openai_chat" && model.endpoint.nvidiaModelId,
  ).length;
  console.log(`wrote ${models.length} models, ${ready} chat endpoints -> ${target}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "snapshot_failed";
  console.error(message);
  process.exitCode = 1;
});
