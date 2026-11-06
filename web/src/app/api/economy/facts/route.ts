import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { loadFacts } from "@/lib/economy/facts-service";
import { marketParam } from "@/lib/economy/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

// Faits structurés du moteur (P11), en JSON : la seule entrée autorisée d'une explication par IA.
// Le proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: NO_STORE });

  const marketId = marketParam(new URL(request.url).searchParams.get("market") ?? undefined);
  const result = await loadFacts(getDatabase(), { marketId, now: new Date() });
  if (!result) return Response.json({ error: "Aucun prix reçu." }, { status: 404, headers: NO_STORE });
  return Response.json(result.facts, { headers: NO_STORE });
}
