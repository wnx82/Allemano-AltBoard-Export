import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { writeSettings } from "@/lib/settings/store";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { itemLabel, loadCoverage, loadEconomy, loadItemHistory } from "./load";
import { ensureOpportunityRun, readRun } from "./runs";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");

let database: TestDatabase;
let tokenId: number;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  tokenId = (await createAgentToken(database.db, "PC de test")).id;
  await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "test", now: NOW });
});

describe("chargement du moteur", () => {
  test("statistiques, recettes connues et crafts évalués depuis la base", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    assert.equal(context.market.auctionKey, "PvE");
    assert.equal(context.today, "2026-11-06");
    assert.equal(context.historyFrom, null);
    assert.equal(context.auctionCut, 0.05);
    assert.equal(context.stats.size, 40);
    assert.equal(context.recipes.length, 37);
    assert.equal(context.crafts.length, 37);
    assert.ok(context.recipes.every((r) => r.characters.length === 1));
    const item = context.stats.get("2576")!;
    assert.equal(item.current?.minCopper, 100);
    assert.equal(item.lastDay, "2026-11-06");
    // Chaque décision est justifiée par au moins une raison.
    assert.ok(context.crafts.every((c) => c.reasons.length > 0));
  });

  test("le début de l'historique suit la date limite des personnages", async () => {
    await writeSettings(database.db, { charactersCutoffAt: new Date("2026-11-04T00:30:00Z") }, NOW);

    const context = (await loadEconomy(database.db, { now: NOW }))!;

    assert.equal(context.historyFrom, "2026-11-04");
    assert.ok([...context.stats.values()].every((s) => s.lastDay === null || s.lastDay >= "2026-11-04"));
    const coverage = await loadCoverage(database.db, context.market.id, context.historyFrom);
    assert.ok(coverage.every((c) => c.day >= "2026-11-04"));
  });

  test("historique d'un objet et nom de repli", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const history = await loadItemHistory(database.db, context.market.id, "2576");
    assert.deepEqual(history.map((d) => d.day), ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-22", "2026-11-05", "2026-11-06"]);
    assert.equal(itemLabel(context.names, "999999"), "Objet 999999");
    assert.equal(itemLabel(context.names, "g:999999:60"), "Objet 999999 (niveau 60)");
  });

  test("un calcul d'opportunités est conservé, puis réutilisé tant que sa base ne change pas", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const first = await ensureOpportunityRun(database.db, context, NOW);
    const second = await ensureOpportunityRun(database.db, (await loadEconomy(database.db, { now: NOW }))!, NOW);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.id, first.id);
    assert.deepEqual(second.opportunities, first.opportunities);
    assert.equal(await countRows(database.db, t.opportunityRuns), 1);
    const stored = (await readRun(database.db, first.id))!;
    assert.equal(stored.opportunities.length, first.opportunities.length);

    // Une nouvelle synchronisation (stocks, recettes) change la base du calcul.
    await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "again", now: new Date(NOW.getTime() + 60_000) });
    const third = await ensureOpportunityRun(database.db, (await loadEconomy(database.db, { now: NOW }))!, NOW);
    assert.equal(third.reused, false);
    assert.equal(await countRows(database.db, t.opportunityRuns), 2);
  });

  test("sans aucun prix reçu, rien n'est calculé", async () => {
    await database.reset();

    assert.equal(await loadEconomy(database.db, { now: NOW }), null);
  });
});
