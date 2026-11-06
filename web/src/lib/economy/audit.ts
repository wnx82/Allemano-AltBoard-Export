import { desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { accountLabel, machineLabel } from "@/lib/dashboard/queries";
import { median } from "./prices";

// Lectures de la page Audit : d'où viennent les prix et les recettes, et quels jours sont incomplets.

export type ImportRow = {
  id: number;
  account: string;
  machine: string | null;
  fileModifiedAt: Date;
  receivedAt: Date;
  items: number;
  observations: number;
  firstDay: string | null;
  lastDay: string | null;
  contentHash: string;
};

export async function listImports(db: Database, marketId: number, limit = 30): Promise<ImportRow[]> {
  const rows = await db
    .select({
      id: t.marketImports.id,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
      machineDisplayName: t.machines.displayName,
      machineHostname: t.machines.hostname,
      fileModifiedAt: t.marketImports.fileModifiedAt,
      receivedAt: t.marketImports.receivedAt,
      items: t.marketImports.itemsCount,
      observations: t.marketImports.observationsCount,
      firstDay: t.marketImports.firstDay,
      lastDay: t.marketImports.lastDay,
      contentHash: t.marketImports.contentHash,
    })
    .from(t.marketImports)
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.marketImports.accountId))
    .leftJoin(t.machines, eq(t.machines.id, t.marketImports.machineId))
    .where(eq(t.marketImports.marketId, marketId))
    .orderBy(desc(t.marketImports.receivedAt), desc(t.marketImports.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    account: accountLabel({ displayName: row.accountDisplayName, folderHint: row.accountFolderHint }),
    machine: row.machineHostname || row.machineDisplayName ? machineLabel({ displayName: row.machineDisplayName, hostname: row.machineHostname }) : null,
    fileModifiedAt: row.fileModifiedAt,
    receivedAt: row.receivedAt,
    items: row.items,
    observations: row.observations,
    firstDay: row.firstDay,
    lastDay: row.lastDay,
    contentHash: row.contentHash,
  }));
}

export async function listRecipeSources(db: Database) {
  return db
    .select({
      characterId: t.characters.id,
      name: t.characters.name,
      class: t.characters.class,
      fileModifiedAt: t.characterRecipeSources.fileModifiedAt,
      updatedAt: t.characterRecipeSources.updatedAt,
      contentHash: t.characterRecipeSources.contentHash,
    })
    .from(t.characterRecipeSources)
    .innerJoin(t.characters, eq(t.characters.id, t.characterRecipeSources.characterId))
    .orderBy(desc(t.characterRecipeSources.fileModifiedAt));
}

/** Un jour qui relève moins de la moitié des objets habituels est un scan partiel. */
export const PARTIAL_SCAN_RATIO = 0.5;

export function markPartialDays(coverage: readonly { day: string; items: number }[]): { day: string; items: number; partial: boolean }[] {
  const typical = median(coverage.map((c) => c.items)) ?? 0;
  return coverage.map((c) => ({ ...c, partial: typical > 0 && c.items < typical * PARTIAL_SCAN_RATIO }));
}
