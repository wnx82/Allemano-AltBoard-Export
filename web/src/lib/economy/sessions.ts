import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { valueSession, type SessionValuation } from "./farm";

// Sessions de farm (V2) : deux relevés réels des sacs et de la banque d'un personnage, au début et
// à la fin. La durée est celle du jeu, entre les deux relevés (bagsAt d'AltBoard), pas celle des
// clics sur le site : un po/h n'est donné que sur une différence d'inventaire effectivement relevée.

export const MAX_LABEL_LENGTH = 80;

export type SessionResult = { ok: true; id: number } | { ok: false; error: string };

type Snapshot = { sourceAt: Date; money: number | null; items: { location: string; itemKey: string; quantity: number }[] };

async function snapshot(db: Database, characterId: number): Promise<Snapshot | { error: string }> {
  const [character] = await db
    .select({ bagsAt: t.characters.bagsAt, money: t.characters.moneyCopper })
    .from(t.characters)
    .where(eq(t.characters.id, characterId));
  if (!character) return { error: "Personnage introuvable." };
  if (!character.bagsAt) return { error: "Aucun relevé des sacs pour ce personnage : ouvrez ses sacs en jeu, puis synchronisez." };
  const items = await db
    .select({ location: t.characterItems.location, itemKey: t.characterItems.itemKey, quantity: t.characterItems.quantity })
    .from(t.characterItems)
    .where(eq(t.characterItems.characterId, characterId));
  return { sourceAt: character.bagsAt, money: character.money, items };
}

/** Démarre une session sur le dernier relevé connu du personnage. Une seule session ouverte par personnage. */
export async function startFarmSession(db: Database, input: { characterId: number; label: string | null; now: Date }): Promise<SessionResult> {
  const start = await snapshot(db, input.characterId);
  if ("error" in start) return { ok: false, error: start.error };
  const [open] = await db
    .select({ id: t.farmSessions.id })
    .from(t.farmSessions)
    .where(and(eq(t.farmSessions.characterId, input.characterId), isNull(t.farmSessions.endedAt)));
  if (open) return { ok: false, error: ALREADY_OPEN };
  try {
    return await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(t.farmSessions)
        .values({
          characterId: input.characterId,
          label: input.label,
          startedAt: input.now,
          startSourceAt: start.sourceAt,
          startMoneyCopper: start.money,
        })
        .returning({ id: t.farmSessions.id });
      if (start.items.length > 0) {
        await tx.insert(t.farmSessionItems).values(start.items.map((item) => ({ sessionId: session.id, phase: "start", ...item })));
      }
      return { ok: true as const, id: session.id };
    });
  } catch (error) {
    // Deux démarrages simultanés : l'index unique des sessions ouvertes refuse le second.
    if (isUniqueViolation(error)) return { ok: false, error: ALREADY_OPEN };
    throw error;
  }
}

const ALREADY_OPEN = "Une session est déjà en cours pour ce personnage.";

/** Code PostgreSQL 23505, porté par l'erreur ou par sa cause (Drizzle enveloppe l'erreur du pilote). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Termine une session : exige un relevé des sacs postérieur à celui du début. */
export async function endFarmSession(db: Database, input: { sessionId: number; now: Date }): Promise<SessionResult> {
  const [session] = await db.select().from(t.farmSessions).where(eq(t.farmSessions.id, input.sessionId));
  if (!session) return { ok: false, error: "Session introuvable." };
  if (session.endedAt) return { ok: false, error: "Cette session est déjà terminée." };
  const end = await snapshot(db, session.characterId);
  if ("error" in end) return { ok: false, error: end.error };
  if (end.sourceAt.getTime() <= session.startSourceAt.getTime()) {
    return {
      ok: false,
      error: "Aucun nouveau relevé des sacs depuis le début de la session : faites /reload ou déconnectez-vous, puis synchronisez.",
    };
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(t.farmSessions)
      .set({ endedAt: input.now, endSourceAt: end.sourceAt, endMoneyCopper: end.money })
      .where(and(eq(t.farmSessions.id, session.id), isNull(t.farmSessions.endedAt)))
      .returning({ id: t.farmSessions.id });
    if (!updated) return { ok: false as const, error: "Cette session est déjà terminée." };
    if (end.items.length > 0) {
      await tx.insert(t.farmSessionItems).values(end.items.map((item) => ({ sessionId: session.id, phase: "end", ...item })));
    }
    return { ok: true as const, id: session.id };
  });
}

/** Abandonne une session en cours : rien n'est conservé. Une session terminée ne s'efface pas ici. */
export async function cancelFarmSession(db: Database, sessionId: number): Promise<SessionResult> {
  const deleted = await db
    .delete(t.farmSessions)
    .where(and(eq(t.farmSessions.id, sessionId), isNull(t.farmSessions.endedAt)))
    .returning({ id: t.farmSessions.id });
  return deleted.length > 0 ? { ok: true, id: sessionId } : { ok: false, error: "Aucune session en cours à abandonner." };
}

export type FarmSessionView = {
  id: number;
  label: string | null;
  character: { id: number; name: string; class: string | null; zone: string | null };
  startedAt: Date;
  endedAt: Date | null;
  startSourceAt: Date;
  endSourceAt: Date | null;
  valuation: SessionValuation | null;
};

/**
 * Sessions, des plus récentes aux plus anciennes, valorisées au prix du marché actuel.
 * @param valueOf valeur réalisable d'une unité (commission déduite), ou null si inconnue
 */
export async function listFarmSessions(db: Database, valueOf: (itemKey: string) => number | null, limit = 50): Promise<FarmSessionView[]> {
  const sessions = await db
    .select({
      session: t.farmSessions,
      character: { id: t.characters.id, name: t.characters.name, class: t.characters.class, zone: t.characters.zone },
    })
    .from(t.farmSessions)
    .innerJoin(t.characters, eq(t.characters.id, t.farmSessions.characterId))
    .orderBy(desc(t.farmSessions.startedAt), desc(t.farmSessions.id))
    .limit(limit);
  if (sessions.length === 0) return [];
  const items = await db
    .select()
    .from(t.farmSessionItems)
    .where(inArray(t.farmSessionItems.sessionId, sessions.map(({ session }) => session.id)));
  const byPhase = new Map<string, Map<string, number>>();
  for (const item of items) {
    const key = `${item.sessionId}:${item.phase}`;
    const map = byPhase.get(key) ?? new Map<string, number>();
    // Sacs et banque confondus : un objet déposé à la banque n'est ni gagné ni perdu.
    map.set(item.itemKey, (map.get(item.itemKey) ?? 0) + item.quantity);
    byPhase.set(key, map);
  }
  return sessions.map(({ session, character }) => {
    const ended = session.endedAt !== null && session.endSourceAt !== null;
    const valuation = ended
      ? valueSession(
          byPhase.get(`${session.id}:start`) ?? new Map(),
          byPhase.get(`${session.id}:end`) ?? new Map(),
          (session.endMoneyCopper ?? 0) - (session.startMoneyCopper ?? 0),
          Math.round((session.endSourceAt!.getTime() - session.startSourceAt.getTime()) / 1000),
          valueOf,
        )
      : null;
    return {
      id: session.id,
      label: session.label,
      character,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      startSourceAt: session.startSourceAt,
      endSourceAt: session.endSourceAt,
      valuation,
    };
  });
}

export type FarmComparison = { key: string; label: string; sessions: number; seconds: number; totalValue: number; perHour: number | null };

/** Rendement cumulé par libellé de session et par personnage : total gagné ÷ durée totale. */
export function compareSessions(sessions: readonly FarmSessionView[], by: "label" | "character"): FarmComparison[] {
  const groups = new Map<string, FarmComparison>();
  for (const session of sessions) {
    if (!session.valuation || session.valuation.durationSeconds <= 0) continue;
    const key = by === "label" ? (session.label?.trim().toLowerCase() || "—") : String(session.character.id);
    const label = by === "label" ? session.label?.trim() || "Sans libellé" : session.character.name;
    const group = groups.get(key) ?? { key, label, sessions: 0, seconds: 0, totalValue: 0, perHour: null };
    group.sessions += 1;
    group.seconds += session.valuation.durationSeconds;
    group.totalValue += session.valuation.totalValue;
    group.perHour = Math.round((group.totalValue * 3600) / group.seconds);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (b.perHour ?? 0) - (a.perHour ?? 0) || a.label.localeCompare(b.label));
}

export type FarmCharacter = { id: number; name: string; class: string | null; level: number | null; zone: string | null; bagsAt: Date | null };

/** Personnages proposés au démarrage d'une session : seuls ceux dont les sacs ont été relevés. */
export async function listFarmCharacters(db: Database): Promise<FarmCharacter[]> {
  const rows = await db
    .select({ id: t.characters.id, name: t.characters.name, class: t.characters.class, level: t.characters.level, zone: t.characters.zone, bagsAt: t.characters.bagsAt })
    .from(t.characters)
    .where(and(eq(t.characters.hidden, false), isNotNull(t.characters.bagsAt)))
    .orderBy(desc(t.characters.bagsAt));
  return rows;
}
