import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { agentTokens } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";

// Jeton d'agent : préfixe reconnaissable + 256 bits aléatoires. Seul son SHA-256 est stocké ;
// l'entropie rend inutile un hachage lent. Le jeton en clair n'est affiché qu'à sa création.

export const AGENT_TOKEN_PATTERN = /^wab_[A-Za-z0-9_-]{43}$/;

export function generateAgentToken(): string {
  return `wab_${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(token: string): string {
  return sha256Hex(token);
}

/** Extrait le jeton d'un en-tête Authorization, ou null s'il est absent ou mal formé. */
export function parseBearerToken(header: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match && AGENT_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export async function createAgentToken(db: Database, label: string): Promise<{ id: number; token: string }> {
  const token = generateAgentToken();
  const [row] = await db
    .insert(agentTokens)
    .values({ tokenHash: hashAgentToken(token), label: label.trim().slice(0, 120) })
    .returning({ id: agentTokens.id });
  return { id: row.id, token };
}

/** Identifiant du jeton actif correspondant, ou null (inconnu ou révoqué). */
export async function findActiveToken(db: Database, token: string): Promise<number | null> {
  const [row] = await db
    .select({ id: agentTokens.id })
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, hashAgentToken(token)), isNull(agentTokens.revokedAt)));
  return row?.id ?? null;
}

export async function revokeAgentToken(db: Database, id: number, now: Date): Promise<boolean> {
  const revoked = await db
    .update(agentTokens)
    .set({ revokedAt: now })
    .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
    .returning({ id: agentTokens.id });
  return revoked.length > 0;
}
