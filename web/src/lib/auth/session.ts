import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDatabase, type Database } from "@/db/client";
import { adminUsers, sessions } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { SESSION_DAYS, sessionCookieName, sessionCookieOptions } from "./cookie";

export type Session = { userId: number; email: string };

// L'identifiant de session est aléatoire (256 bits) ; seule son empreinte est stockée, si bien
// qu'une lecture de la table ne permet pas de voler une session.

export async function createSession(db: Database, userId: number, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.insert(sessions).values({
    tokenHash: sha256Hex(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function findSession(db: Database, token: string | undefined, now: Date): Promise<Session | null> {
  if (!token) return null;
  const [row] = await db
    .select({ userId: adminUsers.id, email: adminUsers.email })
    .from(sessions)
    .innerJoin(adminUsers, eq(adminUsers.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, now), eq(adminUsers.active, true)));
  return row ?? null;
}

export async function deleteSession(db: Database, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

/** Session de la requête en cours (une seule lecture en base par rendu). */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return findSession(getDatabase(), token, new Date());
});

/** À appeler par toute page, action ou route privée : redirige vers /login sans session valide. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  store.set(sessionCookieName(), "", { ...sessionCookieOptions(), maxAge: 0 });
  return token;
}
