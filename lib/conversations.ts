import type { DatabaseSync } from "node:sqlite";

export type StoredMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
};

export type StoredConversation = {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages?: StoredMessage[];
};

const ROLES = new Set(["system", "user", "assistant"]);

export function listConversations(database: DatabaseSync, owner: string): StoredConversation[] {
  const rows = database
    .prepare(
      `SELECT id, title, model_id, created_at, updated_at
       FROM conversations WHERE owner_token = ? ORDER BY updated_at DESC`,
    )
    .all(owner) as {
    id: string;
    title: string;
    model_id: string;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getConversation(
  database: DatabaseSync,
  owner: string,
  id: string,
): StoredConversation | null {
  const row = database
    .prepare(
      `SELECT id, title, model_id, created_at, updated_at
       FROM conversations WHERE id = ? AND owner_token = ?`,
    )
    .get(id, owner) as
    | {
        id: string;
        title: string;
        model_id: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const messages = database
    .prepare(
      `SELECT id, role, content, created_at FROM messages
       WHERE conversation_id = ? ORDER BY created_at ASC`,
    )
    .all(id) as { id: string; role: StoredMessage["role"]; content: string; created_at: string }[];
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

export function saveConversation(
  database: DatabaseSync,
  owner: string,
  input: {
    id: string;
    title: string;
    modelId: string;
    messages: { id: string; role: string; content: string }[];
  },
): void {
  const now = new Date().toISOString();
  const title = input.title.slice(0, 80) || "未命名对话";
  const messages = input.messages
    .filter(
      (message) =>
        ROLES.has(message.role) &&
        typeof message.content === "string" &&
        message.content.length > 0,
    );
  database.exec("BEGIN");
  try {
    const existing = database
      .prepare("SELECT owner_token FROM conversations WHERE id = ?")
      .get(input.id) as { owner_token: string } | undefined;
    if (existing && existing.owner_token !== owner) {
      throw new Error("forbidden_conversation");
    }
    if (!existing) {
      database
        .prepare(
          `INSERT INTO conversations (id, owner_token, title, model_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.id, owner, title, input.modelId, now, now);
    } else {
      database
        .prepare("UPDATE conversations SET title = ?, model_id = ?, updated_at = ? WHERE id = ? AND owner_token = ?")
        .run(title, input.modelId, now, input.id, owner);
    }
    database.prepare("DELETE FROM messages WHERE conversation_id = ?").run(input.id);
    const insert = database.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    messages.forEach((message, index) => {
      insert.run(message.id.slice(0, 80), input.id, message.role, message.content, `${now}:${index}`);
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function deleteConversation(database: DatabaseSync, owner: string, id: string): boolean {
  const existing = database
    .prepare("SELECT id FROM conversations WHERE id = ? AND owner_token = ?")
    .get(id, owner) as { id: string } | undefined;
  if (!existing) return false;
  database.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  database.prepare("DELETE FROM conversations WHERE id = ? AND owner_token = ?").run(id, owner);
  return true;
}

export function deleteAllConversations(database: DatabaseSync, owner: string): number {
  const rows = database
    .prepare("SELECT id FROM conversations WHERE owner_token = ?")
    .all(owner) as { id: string }[];
  for (const row of rows) {
    database.prepare("DELETE FROM messages WHERE conversation_id = ?").run(row.id);
  }
  const result = database.prepare("DELETE FROM conversations WHERE owner_token = ?").run(owner);
  return Number(result.changes);
}
