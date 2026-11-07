import { connection } from "next/server";

export async function live(): Promise<void> {
  await connection();
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
