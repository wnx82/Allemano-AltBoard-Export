import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteSession, findSession } from "@/lib/auth/session";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { getCharacterDetail, getOverview, listAccounts, listCharacters, listMachines, listRecentRuns } from "./queries";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const NOW = new Date("2026-10-04T14:00:00Z");

let database: TestDatabase;
let queries = 0;

async function sync(payload: SyncPayload, label = "PC de test") {
  const { id } = await createAgentToken(database.db, label);
  return processSync(database.db, payload, { tokenId: id, requestId: "test", now: NOW });
}

/** Document contenant `count` personnages, dérivés du premier personnage de la fixture. */
function withCharacters(count: number): SyncPayload {
  const payload = structuredClone(BASE);
  const template = payload.accounts[0].characters[0];
  payload.accounts = [payload.accounts[0]];
  payload.accounts[0].characters = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    guid: `Player-9999-${String(index).padStart(8, "0")}`,
    name: `Personnage ${index}`,
    level: index % 60,
  }));
  return payload;
}

before(async () => {
  database = await openTestDatabase();
  const original = database.pool.query.bind(database.pool);
  (database.pool as { query: unknown }).query = (...args: unknown[]) => {
    queries++;
    return (original as (...a: unknown[]) => unknown)(...args);
  };
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

describe("lecture du tableau de bord", () => {
  test("base vide : aucune erreur, aucune donnée", async () => {
    assert.deepEqual(await listCharacters(database.db), []);
    assert.deepEqual(await getOverview(database.db), { accounts: 0, machines: 0, lastSync: null });
    assert.deepEqual(await listAccounts(database.db), []);
    assert.deepEqual(await listMachines(database.db), { machines: [], pendingTokens: [] });
    assert.deepEqual(await listRecentRuns(database.db), []);
    assert.equal(await getCharacterDetail(database.db, 1), null);
  });

  test("la liste porte compte, machines et métiers de chaque personnage", async () => {
    await sync(BASE);

    const characters = await listCharacters(database.db);

    assert.equal(characters.length, 6);
    const mage = characters[0];
    assert.deepEqual(
      [mage.name, mage.class, mage.level, mage.realm, mage.moneyCopper, mage.itemLevel, mage.account.label, mage.machines.map((m) => m.label)],
      ["Élodie Brisefer", "MAGE", 25, "ClassicBetaPvE2", 80964, 16.25, "Compte 11…#1", ["PC-FIXTURE"]],
    );
    assert.deepEqual(mage.professions.map((p) => [p.name, p.rank, p.maxRank]), [
      ["Couture", 88, 150],
      ["Enchantement", 47, 75],
      ["Pêche", 1, 75],
      ["Cuisine", 20, 75],
    ]);
    assert.equal(mage.sourceLastSeenAt, new Date(1791118113_000).toISOString());
  });

  test("le nombre de requêtes ne dépend pas du nombre de personnages", async () => {
    const measure = async (count: number) => {
      await database.reset();
      await sync(withCharacters(count));
      queries = 0;
      const characters = await listCharacters(database.db);
      assert.equal(characters.length, count);
      return queries;
    };

    assert.equal(await measure(1), 3);
    assert.equal(await measure(5), 3);
    assert.equal(await measure(50), 3);
  });

  test("la fiche rassemble toutes les sections", async () => {
    await sync(BASE);
    const [{ id }] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.guid, "Player-9999-00000001"));

    const detail = (await getCharacterDetail(database.db, id))!;

    assert.equal(detail.name, "Élodie Brisefer");
    assert.equal(detail.lastMachine, "PC-FIXTURE");
    assert.deepEqual(
      [detail.professions.length, detail.equipment.length, detail.reputations.length, detail.currencies.length, detail.bags.length, detail.bank.length, detail.snapshots.length],
      [4, 14, 10, 1, 54, 40, 1],
    );
    assert.equal(detail.stats?.intellect, 116);
    // Le nom des objets vient du référentiel partagé.
    assert.ok(detail.bags.every((item) => item.name !== null));
  });

  test("comptes et machines sont agrégés", async () => {
    await sync(BASE);

    const accounts = await listAccounts(database.db);
    assert.deepEqual(accounts.map((a) => [a.label, a.characters, a.maxLevel, a.machines.map((m) => m.label)]), [
      ["Compte 11…#1", 4, 25, ["PC-FIXTURE"]],
      ["Compte 22…#1", 2, 13, ["PC-FIXTURE"]],
    ]);
    assert.equal(accounts[0].totalCopper, BASE.accounts[0].characters.reduce((total, c) => total + (c.moneyCopper ?? 0), 0));

    const { machines, pendingTokens } = await listMachines(database.db);
    assert.deepEqual(machines.map((m) => [m.label, m.accounts, m.characters, m.tokens.length]), [["PC-FIXTURE", 2, 6, 1]]);
    assert.deepEqual(pendingTokens, []);

    const overview = await getOverview(database.db);
    assert.deepEqual([overview.accounts, overview.machines, overview.lastSync?.machine], [2, 1, "PC-FIXTURE"]);
    assert.equal((await listRecentRuns(database.db)).length, 1);
  });

  test("un nom d'affichage personnalisé remplace le libellé par défaut", async () => {
    await sync(BASE);
    await database.db.update(t.wowAccounts).set({ displayName: "Compte principal" }).where(eq(t.wowAccounts.folderHint, "11…#1"));
    await database.db.update(t.machines).set({ displayName: "PC du salon" });

    const characters = await listCharacters(database.db);

    assert.equal(characters[0].account.label, "Compte principal");
    assert.deepEqual(characters[0].machines.map((m) => m.label), ["PC du salon"]);
  });
});

describe("accès au tableau de bord", () => {
  test("le mot de passe est haché et vérifié", async () => {
    const hash = await hashPassword("un mot de passe très long");

    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!hash.includes("mot de passe"));
    assert.equal(await verifyPassword("un mot de passe très long", hash), true);
    assert.equal(await verifyPassword("un mot de passe très lonG", hash), false);
    assert.equal(await verifyPassword("x", "format-inconnu"), false);
    assert.equal(await verifyAgainstDummy("n'importe quoi"), false);
    assert.notEqual(hash, await hashPassword("un mot de passe très long"));
  });

  test("une session est valable jusqu'à son expiration, sa suppression ou la désactivation du compte", async () => {
    const [user] = await database.db.insert(t.adminUsers).values({ email: "moi@exemple.test", passwordHash: "x" }).returning();

    const token = await createSession(database.db, user.id, NOW);

    const [stored] = await database.db.select().from(t.sessions);
    assert.notEqual(stored.tokenHash, token);
    assert.deepEqual(await findSession(database.db, token, NOW), { userId: user.id, email: "moi@exemple.test" });
    assert.equal(await findSession(database.db, "jeton-inconnu", NOW), null);
    assert.equal(await findSession(database.db, undefined, NOW), null);
    assert.equal(await findSession(database.db, token, new Date(NOW.getTime() + 31 * 24 * 3600 * 1000)), null);

    await database.db.update(t.adminUsers).set({ active: false });
    assert.equal(await findSession(database.db, token, NOW), null);
    await database.db.update(t.adminUsers).set({ active: true });

    await deleteSession(database.db, token);
    assert.equal(await findSession(database.db, token, NOW), null);
  });
});
