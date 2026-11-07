import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DiscoveredModel, EndpointRecord, ModelStatus, ModelView, SyncRunView } from "@/lib/types";
import { statusFor } from "@/lib/parse-catalog";

type ModelRow = {
  id: string;
  name: string;
  display_name: string;
  publisher: string;
  category: ModelView["category"];
  summary: string;
  free_source: string;
  status: ModelStatus;
  page_url: string;
  logo_url: string | null;
  labels_json: string;
  first_seen_at: string;
  last_seen_at: string;
  missing_runs: number;
};

type EndpointRow = {
  model_id: string;
  method: string;
  url: string | null;
  nvidia_model_id: string | null;
  adapter: EndpointRecord["adapter"];
  params_json: string;
  source: string;
  confirm_status: EndpointRecord["confirmStatus"];
  confirmed_at: string | null;
};

const globalStore = globalThis as unknown as { endpointDb?: DatabaseSync };

function resolveDbPath(): string {
  if (process.env.CATALOG_DB) return process.env.CATALOG_DB;
  const preferred = path.join(process.cwd(), "data", "catalog.db");
  try {
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    fs.accessSync(path.dirname(preferred), fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join("/tmp", "endpoint-desk", "catalog.db");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    return fallback;
  }
}

export function openDatabase(file: string): DatabaseSync {
  const database = new DatabaseSync(file);
  database.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") {
    try {
      database.exec("PRAGMA journal_mode = WAL;");
    } catch {
      // Some hosted filesystems reject WAL. The default journal still works.
    }
  }
  migrate(database);
  return database;
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      publisher TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      free_source TEXT NOT NULL,
      status TEXT NOT NULL,
      page_url TEXT NOT NULL,
      logo_url TEXT,
      labels_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      missing_runs INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS models_id_unique ON models(id);
    CREATE INDEX IF NOT EXISTS models_publisher_idx ON models(publisher);
    CREATE INDEX IF NOT EXISTS models_category_idx ON models(category);
    CREATE INDEX IF NOT EXISTS models_status_idx ON models(status);

    CREATE TABLE IF NOT EXISTS model_endpoints (
      model_id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      url TEXT,
      nvidia_model_id TEXT,
      adapter TEXT NOT NULL,
      params_json TEXT NOT NULL,
      source TEXT NOT NULL,
      confirm_status TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS model_endpoints_adapter_idx ON model_endpoints(model_id, adapter);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      result TEXT NOT NULL,
      added INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      suspected INTEGER NOT NULL DEFAULT 0,
      offlined INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      complete INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_owner_idx ON conversations(owner_token, updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function getDb(): DatabaseSync {
  if (!globalStore.endpointDb) {
    const database = openDatabase(resolveDbPath());
    seedIfEmpty(database);
    globalStore.endpointDb = database;
  }
  return globalStore.endpointDb;
}

function seedIfEmpty(database: DatabaseSync): void {
  const row = database.prepare("SELECT COUNT(*) AS count FROM models").get() as { count: number };
  if (row.count > 0) return;
  const snapshotPath = path.join(process.cwd(), "data", "catalog-snapshot.json");
  if (!fs.existsSync(snapshotPath)) return;
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    fetchedAt?: string;
    models?: DiscoveredModel[];
  };
  if (!snapshot.models?.length) return;
  const when = snapshot.fetchedAt ?? new Date().toISOString();
  applyDiscovered(database, snapshot.models, { mode: "seed", at: when });
  database
    .prepare(
      `INSERT INTO sync_runs (started_at, finished_at, result, added, updated, suspected, offlined, error, complete)
       VALUES (?, ?, 'success', ?, 0, 0, 0, NULL, 1)`,
    )
    .run(when, when, snapshot.models.length);
}

export type ApplyCounts = {
  added: number;
  updated: number;
  suspected: number;
  offlined: number;
};

export function applyDiscovered(
  database: DatabaseSync,
  discovered: DiscoveredModel[],
  options: { mode: "seed" | "sync"; at: string },
): ApplyCounts {
  const counts: ApplyCounts = { added: 0, updated: 0, suspected: 0, offlined: 0 };
  const existingRows = database.prepare("SELECT * FROM models").all() as ModelRow[];
  const existing = new Map(existingRows.map((row) => [row.id, row]));
  const seen = new Set<string>();

  database.exec("BEGIN");
  try {
    for (const model of discovered) {
      seen.add(model.id);
      const previous = existing.get(model.id);
      const endpoint = resolveEndpoint(database, model, previous);
      const status = statusFor(endpoint);
      if (!previous) {
        insertModel(database, model, status, options.at);
        counts.added += 1;
      } else {
        const changed =
          previous.display_name !== model.displayName ||
          previous.summary !== model.summary ||
          previous.category !== model.category ||
          previous.status !== status;
        updateModel(database, model, status, previous.first_seen_at, options.at);
        if (changed) counts.updated += 1;
      }
      upsertEndpoint(database, model.id, endpoint);
    }

    if (options.mode === "sync") {
      for (const previous of existingRows) {
        if (seen.has(previous.id)) continue;
        if (previous.status === "offline") continue;
        if (previous.status === "suspected_offline" || previous.missing_runs >= 1) {
          database
            .prepare("UPDATE models SET status = 'offline', missing_runs = missing_runs + 1 WHERE id = ?")
            .run(previous.id);
          counts.offlined += 1;
        } else {
          database
            .prepare(
              "UPDATE models SET status = 'suspected_offline', missing_runs = 1 WHERE id = ?",
            )
            .run(previous.id);
          counts.suspected += 1;
        }
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return counts;
}

function resolveEndpoint(
  database: DatabaseSync,
  model: DiscoveredModel,
  previous: ModelRow | undefined,
): EndpointRecord | null {
  if (model.endpoint?.url) return model.endpoint;
  if (!previous) return model.endpoint;
  const stored = database
    .prepare("SELECT * FROM model_endpoints WHERE model_id = ?")
    .get(previous.id) as EndpointRow | undefined;
  if (!stored) return model.endpoint;
  return rowToEndpoint(stored);
}

function insertModel(
  database: DatabaseSync,
  model: DiscoveredModel,
  status: ModelStatus,
  at: string,
): void {
  database
    .prepare(
      `INSERT INTO models (
        id, name, display_name, publisher, category, summary, free_source, status,
        page_url, logo_url, labels_json, first_seen_at, last_seen_at, missing_runs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      model.id,
      model.name,
      model.displayName,
      model.publisher,
      model.category,
      model.summary,
      model.freeSource,
      status,
      model.pageUrl,
      model.logoUrl,
      JSON.stringify(model.labels),
      at,
      at,
    );
}

function updateModel(
  database: DatabaseSync,
  model: DiscoveredModel,
  status: ModelStatus,
  firstSeenAt: string,
  at: string,
): void {
  database
    .prepare(
      `UPDATE models SET
        name = ?, display_name = ?, publisher = ?, category = ?, summary = ?, free_source = ?,
        status = ?, page_url = ?, logo_url = ?, labels_json = ?, first_seen_at = ?, last_seen_at = ?,
        missing_runs = 0
      WHERE id = ?`,
    )
    .run(
      model.name,
      model.displayName,
      model.publisher,
      model.category,
      model.summary,
      model.freeSource,
      status,
      model.pageUrl,
      model.logoUrl,
      JSON.stringify(model.labels),
      firstSeenAt,
      at,
      model.id,
    );
}

function upsertEndpoint(database: DatabaseSync, modelId: string, endpoint: EndpointRecord | null): void {
  database.prepare("DELETE FROM model_endpoints WHERE model_id = ?").run(modelId);
  if (!endpoint) return;
  database
    .prepare(
      `INSERT INTO model_endpoints (
        model_id, method, url, nvidia_model_id, adapter, params_json, source, confirm_status, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      modelId,
      endpoint.method,
      endpoint.url,
      endpoint.nvidiaModelId,
      endpoint.adapter,
      JSON.stringify(endpoint.params),
      endpoint.source,
      endpoint.confirmStatus,
      endpoint.confirmedAt,
    );
}

function rowToEndpoint(row: EndpointRow): EndpointRecord {
  return {
    method: "POST",
    url: row.url,
    nvidiaModelId: row.nvidia_model_id,
    adapter: row.adapter,
    confirmStatus: row.confirm_status,
    source: row.source,
    confirmedAt: row.confirmed_at,
    params: JSON.parse(row.params_json) as string[],
  };
}

function rowToView(database: DatabaseSync, row: ModelRow): ModelView {
  const endpointRow = database
    .prepare("SELECT * FROM model_endpoints WHERE model_id = ?")
    .get(row.id) as EndpointRow | undefined;
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    publisher: row.publisher,
    summary: row.summary,
    category: row.category,
    labels: JSON.parse(row.labels_json) as string[],
    pageUrl: row.page_url,
    logoUrl: row.logo_url,
    freeSource: row.free_source,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    endpoint: endpointRow ? rowToEndpoint(endpointRow) : null,
  };
}

export type ModelQuery = {
  q?: string;
  category?: string;
  status?: string;
  publisher?: string;
};

export function listModels(database: DatabaseSync, query: ModelQuery): ModelView[] {
  const clauses = ["1 = 1"];
  const params: string[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    clauses.push(
      "(display_name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR publisher LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  if (query.category) {
    clauses.push("category = ?");
    params.push(query.category);
  }
  if (query.status) {
    clauses.push("status = ?");
    params.push(query.status);
  }
  if (query.publisher) {
    clauses.push("publisher = ?");
    params.push(query.publisher);
  }
  const rows = database
    .prepare(`SELECT * FROM models WHERE ${clauses.join(" AND ")} ORDER BY display_name COLLATE NOCASE`)
    .all(...params) as ModelRow[];
  return rows.map((row) => rowToView(database, row));
}

export function getModel(database: DatabaseSync, id: string): ModelView | null {
  const row = database.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
  return row ? rowToView(database, row) : null;
}

export function listPublishers(database: DatabaseSync): string[] {
  const rows = database
    .prepare("SELECT DISTINCT publisher FROM models ORDER BY publisher COLLATE NOCASE")
    .all() as { publisher: string }[];
  return rows.map((row) => row.publisher);
}

export function startSyncRun(database: DatabaseSync, at: string): number {
  const result = database
    .prepare("INSERT INTO sync_runs (started_at, result) VALUES (?, 'running')")
    .run(at);
  return Number(result.lastInsertRowid);
}

export function finishSyncRun(
  database: DatabaseSync,
  id: number,
  input: {
    at: string;
    result: "success" | "failed";
    counts?: ApplyCounts;
    error?: string | null;
    complete: boolean;
  },
): void {
  const counts = input.counts ?? { added: 0, updated: 0, suspected: 0, offlined: 0 };
  database
    .prepare(
      `UPDATE sync_runs SET finished_at = ?, result = ?, added = ?, updated = ?, suspected = ?, offlined = ?, error = ?, complete = ? WHERE id = ?`,
    )
    .run(
      input.at,
      input.result,
      counts.added,
      counts.updated,
      counts.suspected,
      counts.offlined,
      input.error ?? null,
      input.complete ? 1 : 0,
      id,
    );
}

export function latestSync(database: DatabaseSync): SyncRunView | null {
  const row = database
    .prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1")
    .get() as
    | {
        id: number;
        started_at: string;
        finished_at: string | null;
        result: SyncRunView["result"];
        added: number;
        updated: number;
        suspected: number;
        offlined: number;
        error: string | null;
        complete: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    added: row.added,
    updated: row.updated,
    suspected: row.suspected,
    offlined: row.offlined,
    error: row.error,
    complete: row.complete === 1,
  };
}

export function lastSuccessAt(database: DatabaseSync): string | null {
  const row = database
    .prepare(
      "SELECT finished_at FROM sync_runs WHERE result = 'success' AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get() as { finished_at: string } | undefined;
  return row?.finished_at ?? null;
}

export function getSetting(database: DatabaseSync, key: string, fallback: string): string {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(database: DatabaseSync, key: string, value: string): void {
  database
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
