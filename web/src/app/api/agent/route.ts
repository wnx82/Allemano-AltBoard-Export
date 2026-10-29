import { readFile } from "node:fs/promises";
import { agentDirectory, AGENT_FILE_NAME, findAgent } from "@/lib/agent-download";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const agent = await findAgent(agentDirectory());
  if (!agent) return Response.json({ error: "Agent non disponible sur ce serveur." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const content = await readFile(agent.path);
  console.log(JSON.stringify({ event: "agent.download", format: "exe", userId: session.userId, version: process.env.WOW_AGENT_VERSION || null, bytes: content.length }));
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Disposition": `attachment; filename="${AGENT_FILE_NAME}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
