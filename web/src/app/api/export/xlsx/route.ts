import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { buildExport, exportFileName } from "@/lib/dashboard/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const now = new Date();
  const workbook = await buildExport(getDatabase(), now);
  console.log(JSON.stringify({ event: "export.xlsx", userId: session.userId, bytes: workbook.length }));
  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Content-Length": String(workbook.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
