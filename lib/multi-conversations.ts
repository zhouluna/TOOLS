import type { DatabaseSync } from "node:sqlite";

export type MultiMessage = { id: string; role: "user" | "assistant"; content: string; modelId?: string | null; modelName?: string | null };
export type MultiConversation = { id: string; title: string; modelId: string; messages: MultiMessage[] };

const initialized = new WeakSet<DatabaseSync>();
function init(db: DatabaseSync) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS multi_conversations (
    id TEXT PRIMARY KEY, owner_token TEXT NOT NULL, title TEXT NOT NULL, model_id TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS multi_conversations_owner_idx ON multi_conversations(owner_token, updated_at);
  CREATE TABLE IF NOT EXISTS multi_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, position INTEGER NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, model_id TEXT, model_name TEXT,
    FOREIGN KEY(conversation_id) REFERENCES multi_conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS multi_messages_conversation_idx ON multi_messages(conversation_id, position);`);
  initialized.add(db);
}
export function listMulti(db: DatabaseSync, owner: string) {
  init(db);
  return db.prepare("SELECT id, title, model_id AS modelId, updated_at AS updatedAt FROM multi_conversations WHERE owner_token = ? ORDER BY updated_at DESC").all(owner);
}
export function getMulti(db: DatabaseSync, owner: string, id: string) {
  init(db);
  const row = db.prepare("SELECT id, title, model_id AS modelId FROM multi_conversations WHERE id = ? AND owner_token = ?").get(id, owner);
  if (!row) return null;
  const messages = db.prepare("SELECT id, role, content, model_id AS modelId, model_name AS modelName FROM multi_messages WHERE conversation_id = ? ORDER BY position").all(id);
  return { ...row, messages };
}
export function saveMulti(db: DatabaseSync, owner: string, value: MultiConversation) {
  init(db);
  db.exec("BEGIN");
  try {
    const existing = db.prepare("SELECT owner_token AS owner FROM multi_conversations WHERE id = ?").get(value.id) as { owner: string } | undefined;
    if (existing && existing.owner !== owner) throw new Error("forbidden_conversation");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO multi_conversations(id, owner_token, title, model_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, model_id = excluded.model_id, updated_at = excluded.updated_at`)
      .run(value.id, owner, value.title, value.modelId, now, now);
    db.prepare("DELETE FROM multi_messages WHERE conversation_id = ?").run(value.id);
    const insert = db.prepare("INSERT INTO multi_messages(id, conversation_id, position, role, content, model_id, model_name) VALUES(?, ?, ?, ?, ?, ?, ?)");
    value.messages.forEach((m, i) => insert.run(m.id, value.id, i, m.role, m.content, m.modelId ?? null, m.modelName ?? null));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function deleteMulti(db: DatabaseSync, owner: string, id: string): boolean {
  init(db);
  return Number(db.prepare("DELETE FROM multi_conversations WHERE id = ? AND owner_token = ?").run(id, owner).changes) > 0;
}
