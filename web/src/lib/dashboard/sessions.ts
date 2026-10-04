// Sessions de jeu, telles que relevées par l'addon Allemano Ledger.

export type Session = {
  /** Début de la session (ISO) : c'est aussi son identité. */
  startedAt: string;
  stoppedAt: string | null;
  /** Temps connecté, pauses exclues. */
  durationSeconds: number | null;
  xpGained: number | null;
  /** Expérience par heure de jeu ; null si la durée est inconnue ou inférieure à une minute. */
  xpPerHour: number | null;
  levels: number | null;
  zone: string | null;
  tag: string | null;
  /** Session encore ouverte au dernier relevé : valeurs provisoires. */
  current: boolean;
};

type SessionRow = {
  startedAt: Date;
  stoppedAt: Date | null;
  durationSeconds: number | null;
  xpGained: number | null;
  levels: number | null;
  zone: string | null;
  tag: string | null;
  inProgress: boolean;
};

function perHour(xp: number | null, seconds: number | null): number | null {
  return xp === null || seconds === null || seconds < 60 ? null : Math.round((xp / seconds) * 3600);
}

/**
 * Sessions de la plus ancienne à la plus récente. Seule la dernière peut être « en cours » : une
 * session plus ancienne restée ouverte en base a été close depuis, sans que son état final ait été
 * synchronisé.
 */
export function buildSessions(rows: SessionRow[]): Session[] {
  const ordered = [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  return ordered.map((row, index) => ({
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    xpGained: row.xpGained,
    xpPerHour: perHour(row.xpGained, row.durationSeconds),
    levels: row.levels,
    zone: row.zone,
    tag: row.tag,
    current: row.inProgress && index === ordered.length - 1,
  }));
}

/** Totaux des sessions dont l'expérience et la durée sont toutes deux connues. */
export function summarizeSessions(sessions: Session[]): { xpGained: number; durationSeconds: number; xpPerHour: number | null } {
  const measured = sessions.filter((session) => session.xpGained !== null && session.durationSeconds !== null);
  const xpGained = measured.reduce((sum, session) => sum + session.xpGained!, 0);
  const durationSeconds = measured.reduce((sum, session) => sum + session.durationSeconds!, 0);
  return { xpGained, durationSeconds, xpPerHour: perHour(xpGained, durationSeconds) };
}

// L'addon étiquette les sessions en anglais, quelle que soit la langue du client.
const TAG_LABELS: Record<string, string> = {
  Farming: "Farm",
  Dungeon: "Donjon",
  Raid: "Raid",
  Leveling: "Montée de niveau",
  Questing: "Quêtes",
  Professions: "Métiers",
  PvP: "JcJ",
  Other: "Autre",
};

/** Étiquette de session en français ; une étiquette inconnue est rendue telle quelle. */
export function sessionTagLabel(tag: string | null): string | null {
  return tag === null ? null : (TAG_LABELS[tag] ?? tag);
}
