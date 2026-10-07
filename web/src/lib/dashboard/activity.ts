import { buildHistory, type Change, type SnapshotLike } from "./history";

export type ActivityCharacter = { id: number; name: string; class: string | null; account: string };
export type ActivitySnapshot = SnapshotLike & { character: ActivityCharacter };
export type ActivityEntry = { at: Date; character: ActivityCharacter; changes: Change[] };
export type ActivityDay = { day: string; entries: ActivityEntry[] };

/** Jour civil d'un instant, heure de Bruxelles : AAAA-MM-JJ. */
export const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

/**
 * Changements de tous les personnages depuis `since`, du plus récent au plus ancien, regroupés
 * par jour (heure de Bruxelles). Un relevé antérieur à `since` ne sert que de point de
 * comparaison au premier relevé de la période.
 */
export function buildActivity(snapshots: ActivitySnapshot[], since: Date): ActivityDay[] {
  const entries: ActivityEntry[] = [];
  for (const rows of Map.groupBy(snapshots, (snapshot) => snapshot.character.id).values()) {
    const ordered = rows.toSorted((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    for (const entry of buildHistory(ordered)) {
      if (entry.at >= since) entries.push({ ...entry, character: ordered[0].character });
    }
  }
  entries.sort((a, b) => b.at.getTime() - a.at.getTime() || a.character.name.localeCompare(b.character.name, "fr"));

  return [...Map.groupBy(entries, (entry) => dayKey.format(entry.at))].map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}
