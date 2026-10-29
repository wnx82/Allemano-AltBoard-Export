import { agentDirectory, AGENT_ARCHIVE_NAME, archiveAgent, findAgent } from "@/lib/agent-download";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const agent = await findAgent(agentDirectory());
  if (!agent) return Response.json({ error: "Agent non disponible sur ce serveur." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const version = process.env.WOW_AGENT_VERSION || null;
  const archive = await archiveAgent(agent, version);
  console.log(JSON.stringify({ event: "agent.download", format: "zip", userId: session.userId, version, bytes: archive.size }));
  return new Response(new Uint8Array(archive.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${AGENT_ARCHIVE_NAME}"`,
      "Content-Length": String(archive.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
