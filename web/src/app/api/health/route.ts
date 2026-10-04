import { sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sonde de disponibilité pour l'orchestrateur. Publique et sans détail : ok ou indisponible.
export async function GET(): Promise<Response> {
  try {
    await getDatabase().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
