import { formatItemLevel, formatMoney, REACTION_LABELS } from "@/lib/wow/format";

// Lecture de l'historique : ce qui a changé entre deux snapshots consécutifs d'un personnage.

export type SnapshotData = {
  guild?: string | null;
  professions?: { skillLine: number; name: string; rank: number | null; max: number | null }[];
  reputations?: { factionId: number; name: string; reaction: number | null; current: number | null }[];
};

export type SnapshotLike = {
  capturedAt: Date;
  level: number | null;
  moneyCopper: number | null;
  itemLevel: number | null;
  data: unknown;
};

export type Change = { kind: "level" | "money" | "itemLevel" | "profession" | "reputation" | "guild"; text: string };

const dataOf = (snapshot: SnapshotLike): SnapshotData => (snapshot.data ?? {}) as SnapshotData;

export function describeChanges(previous: SnapshotLike, next: SnapshotLike): Change[] {
  const changes: Change[] = [];

  if (previous.level !== null && next.level !== null && previous.level !== next.level) {
    changes.push({ kind: "level", text: `Niveau ${previous.level} → ${next.level}` });
  }

  for (const profession of dataOf(next).professions ?? []) {
    const before = dataOf(previous).professions?.find((p) => p.skillLine === profession.skillLine);
    if (!before) changes.push({ kind: "profession", text: `Nouveau métier : ${profession.name}${profession.rank === null ? "" : ` (${profession.rank})`}` });
    else if (before.rank !== null && profession.rank !== null && before.rank !== profession.rank) {
      changes.push({ kind: "profession", text: `${profession.name} ${before.rank} → ${profession.rank}` });
    }
  }

  if (previous.moneyCopper !== null && next.moneyCopper !== null && previous.moneyCopper !== next.moneyCopper) {
    const delta = next.moneyCopper - previous.moneyCopper;
    changes.push({ kind: "money", text: `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}` });
  }

  if (previous.itemLevel !== null && next.itemLevel !== null && formatItemLevel(previous.itemLevel) !== formatItemLevel(next.itemLevel)) {
    changes.push({ kind: "itemLevel", text: `Niveau d'objet ${formatItemLevel(previous.itemLevel)} → ${formatItemLevel(next.itemLevel)}` });
  }

  for (const reputation of dataOf(next).reputations ?? []) {
    const before = dataOf(previous).reputations?.find((r) => r.factionId === reputation.factionId);
    if (before && before.reaction !== null && reputation.reaction !== null && before.reaction !== reputation.reaction) {
      const label = (reaction: number) => REACTION_LABELS[reaction] ?? `palier ${reaction}`;
      changes.push({ kind: "reputation", text: `${reputation.name} : ${label(before.reaction)} → ${label(reputation.reaction)}` });
    }
  }

  const guildBefore = dataOf(previous).guild ?? null;
  const guildAfter = dataOf(next).guild ?? null;
  if (guildBefore !== guildAfter) {
    changes.push({ kind: "guild", text: guildAfter === null ? `A quitté ${guildBefore}` : `A rejoint ${guildAfter}` });
  }

  return changes;
}

export type HistoryEntry = { at: Date; changes: Change[] };

/** Changements du plus récent au plus ancien ; les snapshots sans changement lisible sont omis. */
export function buildHistory(snapshots: SnapshotLike[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const changes = describeChanges(snapshots[i - 1], snapshots[i]);
    if (changes.length > 0) entries.push({ at: snapshots[i].capturedAt, changes });
  }
  return entries.reverse();
}
