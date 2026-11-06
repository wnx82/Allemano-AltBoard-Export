import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { processSync } from "./process";
import type { AccountPayload, SyncPayload } from "./schema";

// Document produit par l'agent réel à partir des fixtures account-four-characters.lua,
// auctionator-multi-day.lua et naowh-recipes.lua (voir tests/fixtures/README.md).
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const MAGE = "Player-9999-00000001";
const NOW = new Date("2026-11-06T18:00:00Z");
const OTHER_ACCOUNT = "b".repeat(64);

let database: TestDatabase;
let tokenId: number;
let token: string;

const clone = (): SyncPayload => structuredClone(BASE);
const account = (payload: SyncPayload): AccountPayload => payload.accounts[0];
const market = (payload: SyncPayload) => account(payload).auctionator!.markets[0];
const observations = () => market(BASE).items.reduce((total, item) => total + item.days.length, 0);
const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);
const sync = (payload: SyncPayload, now = NOW) => processSync(database.db, payload, { tokenId, requestId: "test", now });

async function dayRow(itemKey: string, day: string) {
  const [row] = await database.db
    .select()
    .from(t.marketItemDays)
    .where(and(eq(t.marketItemDays.itemKey, itemKey), eq(t.marketItemDays.day, day)));
  return row;
}

async function totals() {
  return {
    markets: await count(t.markets),
    imports: await count(t.marketImports),
    days: await count(t.marketItemDays),
    latest: await count(t.marketItemLatest),
    vendor: await count(t.vendorPrices),
    recipes: await count(t.recipes),
    reagents: await count(t.recipeReagents),
    characterRecipes: await count(t.characterRecipes),
  };
}

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  const created = await createAgentToken(database.db, "PC de test");
  token = created.token;
  tokenId = created.id;
});

describe("prix Auctionator", () => {
  test("le document de l'agent est accepté et importé tel quel", async () => {
    const response = await handleSyncRequest(
      new Request("https://wow.example.test/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(clone()),
      }),
      { db: database.db, rateLimiter: new RateLimiter(), now: () => NOW, log: () => {} },
    );
    const json = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200, JSON.stringify(json));
    assert.deepEqual([json.marketsImported, json.marketsUnchanged, json.marketObservations, json.recipeCharacters], [1, 0, observations(), 1]);
    const recipes = account(BASE).recipes!.characters[0].recipes;
    assert.deepEqual(await totals(), {
      markets: 1,
      imports: 1,
      days: observations(),
      latest: market(BASE).items.filter((item) => item.lastMin !== undefined).length,
      vendor: account(BASE).auctionator!.vendorPrices.length,
      recipes: recipes.length,
      reagents: recipes.reduce((total, r) => total + r.reagents.length, 0),
      characterRecipes: recipes.length,
    });

    const [row] = await database.db.select().from(t.markets);
    assert.deepEqual([row.flavor, row.auctionKey], ["_forever_", "PvE"]);
    // Relevés réels de l'objet 2576 : jour Auctionator 2482 = 2026-10-18, l = 300, h = 500, a = 76.
    const day = await dayRow("2576", "2026-10-18");
    assert.deepEqual([day.lowCopper, day.highCopper, day.available], [300, 500, 76]);
    const [latest] = await database.db.select().from(t.marketItemLatest).where(eq(t.marketItemLatest.itemKey, "2576"));
    assert.deepEqual([latest.minCopper, latest.day], [100, "2026-11-06"]);
    const [imported] = await database.db.select().from(t.marketImports);
    assert.deepEqual([imported.firstDay, imported.lastDay, imported.itemsCount], ["2026-10-04", "2026-11-06", 40]);
  });

  test("le même relevé envoyé dix fois ne crée aucun doublon", async () => {
    await sync(clone());
    const first = await totals();

    for (let i = 0; i < 10; i++) {
      const result = await sync(clone(), new Date(NOW.getTime() + (i + 1) * 60_000));
      assert.deepEqual([result.marketsImported, result.marketsUnchanged, result.marketObservations], [0, 1, 0]);
    }

    assert.deepEqual(await totals(), first);
  });

  test("deux comptes relevant le même jour fusionnent plus bas, plus haut et quantité", async () => {
    await sync(clone());
    const other = clone();
    const a = account(other);
    a.accountKey = OTHER_ACCOUNT;
    a.characters = [];
    a.recipes = undefined;
    const m = a.auctionator!.markets[0];
    m.contentHash = "c".repeat(64);
    m.items = [{ key: "2576", lastMin: 90, days: [[2482, 250, 450, 80], [2501, 120, 140, 5]] }];
    // Même jour, fichier plus récent : son dernier prix l'emporte.
    a.auctionator!.file.modifiedAt = new Date(Date.parse(account(BASE).auctionator!.file.modifiedAt) + 3_600_000).toISOString();

    const result = await sync(other);

    assert.deepEqual([result.marketsImported, result.marketObservations], [1, 2]);
    const merged = await dayRow("2576", "2026-10-18");
    assert.deepEqual([merged.lowCopper, merged.highCopper, merged.available], [250, 500, 80]);
    const today = await dayRow("2576", "2026-11-06");
    assert.deepEqual([today.lowCopper, today.highCopper, today.available], [100, 140, 13]);
    const [latest] = await database.db.select().from(t.marketItemLatest).where(eq(t.marketItemLatest.itemKey, "2576"));
    assert.equal(latest.minCopper, 90);
    assert.equal(await count(t.markets), 1);
    assert.equal(await count(t.marketImports), 2);
  });

  test("un fichier plus ancien ne remplace ni le dernier prix ni un prix marchand", async () => {
    await sync(clone());
    const older = clone();
    const a = account(older);
    a.accountKey = OTHER_ACCOUNT;
    a.characters = [];
    a.recipes = undefined;
    a.auctionator!.file.modifiedAt = "2026-11-01T10:00:00.000Z";
    a.auctionator!.vendorPrices = [{ key: a.auctionator!.vendorPrices[0].key, price: 1 }];
    const m = a.auctionator!.markets[0];
    m.contentHash = "d".repeat(64);
    m.items = [{ key: "2576", lastMin: 5, days: [[2501, 5, 5, 1]] }];

    await sync(older);

    const [latest] = await database.db.select().from(t.marketItemLatest).where(eq(t.marketItemLatest.itemKey, "2576"));
    assert.equal(latest.minCopper, 100);
    const [vendor] = await database.db.select().from(t.vendorPrices).where(eq(t.vendorPrices.itemKey, account(BASE).auctionator!.vendorPrices[0].key));
    assert.equal(vendor.priceCopper, account(BASE).auctionator!.vendorPrices[0].price);
    // Le plus bas du jour, lui, reste un fait : il est fusionné quel que soit l'âge du fichier.
    assert.equal((await dayRow("2576", "2026-11-06")).lowCopper, 5);
  });

  test("le même nom d'hôtel des ventes dans un autre client est un autre marché", async () => {
    await sync(clone());
    const beta = clone();
    account(beta).flavor = "_classic_beta_";
    account(beta).accountKey = OTHER_ACCOUNT;
    account(beta).characters = [];

    await sync(beta);

    const rows = await database.db.select().from(t.markets).orderBy(asc(t.markets.flavor));
    assert.deepEqual(rows.map((r) => r.flavor), ["_classic_beta_", "_forever_"]);
    assert.equal(await count(t.marketItemDays), 2 * observations());
  });

  test("un relevé incohérent est refusé avant toute écriture", async () => {
    const payload = clone();
    market(payload).items[0].days[0] = [2482, 600, 500, 1];

    const response = await handleSyncRequest(
      new Request("https://wow.example.test/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }),
      { db: database.db, rateLimiter: new RateLimiter(), now: () => NOW, log: () => {} },
    );

    assert.equal(response.status, 422);
    assert.equal(await count(t.marketItemDays), 0);
    assert.equal(await count(t.characters), 0);
  });
});

describe("recettes NaowhForever", () => {
  const recipesOf = async (guid: string) => {
    const rows = await database.db
      .select({ spellId: t.characterRecipes.spellId })
      .from(t.characterRecipes)
      .innerJoin(t.characters, eq(t.characters.id, t.characterRecipes.characterId))
      .where(eq(t.characters.guid, guid))
      .orderBy(asc(t.characterRecipes.spellId));
    return rows.map((r) => r.spellId);
  };

  test("les recettes réelles et leurs composants sont rattachés au personnage", async () => {
    await sync(clone());

    const spells = account(BASE).recipes!.characters[0].recipes.map((r) => r.spellId);
    assert.deepEqual(await recipesOf(MAGE), [...spells].sort((a, b) => a - b));
    const [bolt] = await database.db.select().from(t.recipes).where(eq(t.recipes.spellId, 2963));
    assert.deepEqual([bolt.outputItemId, bolt.outputQuantity, bolt.skillLine, bolt.cooldown], [2996, 1, 197, false]);
    const reagents = await database.db.select().from(t.recipeReagents).where(eq(t.recipeReagents.spellId, 2963));
    assert.deepEqual(reagents.map((r) => [r.itemId, r.quantity]), [[2589, 2]]);
  });

  test("une recette oubliée disparaît, un fichier plus ancien ne change rien", async () => {
    await sync(clone());
    const spells = account(BASE).recipes!.characters[0].recipes.map((r) => r.spellId);

    const older = clone();
    account(older).recipes!.file.modifiedAt = "2026-10-01T00:00:00.000Z";
    account(older).recipes!.characters[0].recipes = account(older).recipes!.characters[0].recipes.slice(0, 1);
    await sync(older);
    assert.equal((await recipesOf(MAGE)).length, spells.length);

    const newer = clone();
    account(newer).recipes!.file.modifiedAt = "2026-12-01T00:00:00.000Z";
    account(newer).recipes!.characters[0].recipes = account(newer).recipes!.characters[0].recipes.slice(0, 2);
    const result = await sync(newer);
    assert.equal(result.recipeCharacters, 1);
    assert.equal((await recipesOf(MAGE)).length, 2);
    // La recette reste connue du catalogue : un autre personnage peut la connaître.
    assert.equal(await count(t.recipes), spells.length);
  });

  test("un personnage inconnu d'AltBoard ne reçoit rien", async () => {
    const payload = clone();
    account(payload).recipes!.characters[0].guid = "Player-9999-0000ABCD";

    const result = await sync(payload);

    assert.equal(result.recipeCharacters, 0);
    assert.equal(await count(t.characterRecipes), 0);
  });
});
