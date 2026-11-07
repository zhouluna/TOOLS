import { syncStatus } from "@/lib/sync";
import { json, live } from "@/lib/http";

export async function GET(): Promise<Response> {
  await live();
  return json(syncStatus());
}
