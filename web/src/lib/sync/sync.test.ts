import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { processSync } from "./process";
import type { CharacterPayload, SyncPayload } from "./schema";

// Document produit par l'agent réel à partir des fixtures AltBoard.lua anonymisées.
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const MAGE = "Player-9999-00000001";
const PC2 = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-04T14:00:00Z");

let database: TestDatabase;
let token: string;
let logs: Record<string, unknown>[];

const clone = (): SyncPayload => structuredClone(BASE);
const mageOf = (payload: SyncPayload): CharacterPayload => payload.accounts[0].characters.find((c) => c.guid === MAGE)!;
const onlyAccount = (index: number): SyncPayload => ({ ...clone(), accounts: [clone().accounts[index]] });
const fromMachine = (payload: SyncPayload, uuid: string, hostname: string): SyncPayload => ({ ...payload, machine: { uuid, hostname } });

type SendOptions = { token?: string | null; contentType?: string; raw?: string; maxBodyBytes?: number; limiter?: RateLimiter; headers?: Record<string, string> };

async function send(body: unknown, options: SendOptions = {}): Promise<{ status: number; json: Record<string, unknown>; response: Response }> {
  const bearer = options.token === undefined ? token : options.token;
  const response = await handleSyncRequest(
    new Request("https://wow.example.test/api/sync", {
      method: "POST",
      headers: {
        "content-type": options.contentType ?? "application/json",
        ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
        ...options.headers,
      },
      body: options.raw ?? JSON.stringify(body),
    }),
    {
      db: database.db,
      rateLimiter: options.limiter ?? new RateLimiter(),
      now: () => NOW,
      log: (event) => logs.push(event),
      maxBodyBytes: options.maxBodyBytes,
    },
  );
  return { status: response.status, json: (await response.json()) as Record<string, unknown>, response };
}

async function ok(body: SyncPayload, options: SendOptions = {}): Promise<Record<string, unknown>> {
  const { status, json } = await send(body, options);
  assert.equal(status, 200, JSON.stringify(json));
  return json;
}

const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);
const sum = (of: (character: CharacterPayload) => number) => BASE.accounts.flatMap((a) => a.characters).reduce((total, c) => total + of(c), 0);

/** Vérifie qu'une écriture est refusée par la contrainte PostgreSQL attendue. */
async function rejectedBy(constraint: string, write: PromiseLike<unknown>): Promise<void> {
  await assert.rejects(Promise.resolve(write), (error: unknown) => {
    const cause = (error as { cause?: { constraint?: string } }).cause ?? (error as { constraint?: string });
    assert.equal(cause.constraint, constraint);
    return true;
  });
}

async function character(guid: string) {
  const [row] = await database.db.select().from(t.characters).where(eq(t.characters.guid, guid));
  return row;
}

async function totals() {
  return {
    machines: await count(t.machines),
    accounts: await count(t.wowAccounts),
    realms: await count(t.realms),
    characters: await count(t.characters),
    professions: await count(t.characterProfessions),
    equipment: await count(t.characterEquipment),
    reputations: await count(t.characterReputations),
    currencies: await count(t.characterCurrencies),
    stats: await count(t.characterStats),
    items: await count(t.characterItems),
    snapshots: await count(t.characterSnapshots),
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
  logs = [];
  token = (await createAgentToken(database.db, "PC de test")).token;
});

describe("document valide", () => {
  test("crée machine, comptes, royaume, personnages et snapshots", async () => {
    const result = await ok(clone());

    assert.deepEqual(
      {
        accountsReceived: result.accountsReceived,
        charactersReceived: result.charactersReceived,
        charactersCreated: result.charactersCreated,
        charactersUpdated: result.charactersUpdated,
        charactersUnchanged: result.charactersUnchanged,
        charactersStale: result.charactersStale,
        snapshotsCreated: result.snapshotsCreated,
        status: result.status,
      },
      {
        accountsReceived: 2,
        charactersReceived: 6,
        charactersCreated: 6,
        charactersUpdated: 0,
        charactersUnchanged: 0,
        charactersStale: 0,
        snapshotsCreated: 6,
        status: "success",
      },
    );
    assert.deepEqual(await totals(), {
      machines: 1,
      accounts: 2,
      realms: 1,
      characters: 6,
      professions: sum((c) => c.professions.length),
      equipment: sum((c) => c.gear.length),
      reputations: sum((c) => c.reputations.length),
      currencies: sum((c) => c.currencies.length),
      stats: 6,
      items: sum((c) => (c.bags?.items.length ?? 0) + (c.bank?.items.length ?? 0)),
      snapshots: 6,
    });
  });

  test("les valeurs stockées sont celles du fichier AltBoard", async () => {
    await ok(clone());

    const mage = await character(MAGE);
    assert.equal(mage.name, "Élodie Brisefer");
    assert.equal(mage.class, "MAGE");
    assert.equal(mage.race, "Éolide de l’Ordre suprême");
    assert.equal(mage.level, 25);
    assert.equal(mage.xp, 29426);
    assert.equal(mage.restedXp, null);
    assert.equal(mage.moneyCopper, 80964);
    assert.equal(mage.itemLevel, 16.25);
    assert.equal(mage.guild, "Les Sans-Souci");
    assert.equal(mage.zone, "Taverne du Corbeau écarlate");
    assert.equal(mage.sourceLastSeenAt.getTime(), 1791118113_000);
    assert.equal(mage.bankAt?.getTime(), 1791111262_000);
    assert.deepEqual([mage.bagSlotsUsed, mage.bagSlotsTotal, mage.bankSlotsUsed, mage.bankSlotsTotal], [57, 58, 52, 54]);

    const professions = await database.db
      .select({ name: t.characterProfessions.name, rank: t.characterProfessions.rank, max: t.characterProfessions.maxRank, primary: t.characterProfessions.isPrimary })
      .from(t.characterProfessions)
      .where(eq(t.characterProfessions.characterId, mage.id))
      .orderBy(asc(t.characterProfessions.position));
    assert.deepEqual(professions, [
      { name: "Couture", rank: 88, max: 150, primary: true },
      { name: "Enchantement", rank: 47, max: 75, primary: true },
      { name: "Pêche", rank: 1, max: 75, primary: false },
      { name: "Cuisine", rank: 20, max: 75, primary: false },
    ]);

    const [chest] = await database.db
      .select()
      .from(t.characterEquipment)
      .where(eq(t.characterEquipment.characterId, mage.id))
      .orderBy(asc(t.characterEquipment.slot))
      .offset(2)
      .limit(1);
    assert.deepEqual([chest.slot, chest.itemId, chest.enchantId, chest.name, chest.quality, chest.itemLevel], [5, 2969, 24, "Gilet de lieur de sort", 2, 17]);

    const [stats] = await database.db.select().from(t.characterStats).where(eq(t.characterStats.characterId, mage.id));
    assert.deepEqual([stats.intellect, stats.armor, stats.powerType, stats.crit, stats.defense], [116, 453, "MANA", 0.896000325679779, null]);
  });

  test("le compte n'est connu que par son empreinte et un libellé masqué", async () => {
    await ok(clone());

    const accounts = await database.db.select().from(t.wowAccounts).orderBy(asc(t.wowAccounts.id));
    assert.deepEqual(accounts.map((a) => a.folderHint), ["11…#1", "22…#1"]);
    assert.ok(accounts.every((a) => /^[0-9a-f]{64}$/.test(a.accountKey)));
  });

  test("la réponse n'est jamais mise en cache et porte un identifiant de requête", async () => {
    const { response, json } = await send(clone());

    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-request-id"), json.requestId);
    assert.equal(logs.at(-1)?.event, "sync.received");
    assert.equal(logs.at(-1)?.characters, 6);
  });
});

describe("idempotence", () => {
  test("le même document envoyé dix fois ne duplique rien", async () => {
    await ok(clone());
    const after1 = await totals();

    for (let i = 0; i < 9; i++) {
      const result = await ok(clone());
      assert.deepEqual([result.charactersCreated, result.charactersUpdated, result.charactersUnchanged, result.snapshotsCreated], [0, 0, 6, 0]);
    }

    assert.deepEqual(await totals(), after1);
    assert.equal(await count(t.syncRuns), 10);
    assert.equal(await count(t.machineAccounts), 2);
    assert.equal(await count(t.characterMachines), 6);
  });

  test("l'ordre des clés du document ne change pas le résultat", async () => {
    await ok(clone());
    const reordered = clone();
    reordered.accounts[0].characters = reordered.accounts[0].characters.map((c) => Object.fromEntries(Object.entries(c).reverse()) as CharacterPayload);

    const result = await ok(reordered);

    assert.equal(result.charactersUnchanged, 6);
  });
});

describe("refus", () => {
  test("jeton absent, mal formé, inconnu ou révoqué : 401 et rien n'est écrit", async () => {
    const revoked = await createAgentToken(database.db, "révoqué");
    await revokeAgentToken(database.db, revoked.id, NOW);

    for (const bad of [null, "pas-un-jeton", `wab_${"x".repeat(43)}`, revoked.token, token.slice(0, -1)]) {
      const { status, json, response } = await send(clone(), { token: bad });
      assert.equal(status, 401, String(bad));
      assert.equal(json.code, "unauthorized");
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
    }

    assert.equal(await count(t.machines), 0);
    assert.equal(await count(t.characters), 0);
    assert.equal(await count(t.syncRuns), 0);
  });

  test("document invalide : 422 sans jamais renvoyer les valeurs reçues", async () => {
    const cases: [string, (p: SyncPayload) => unknown][] = [
      ["champ inconnu", (p) => ({ ...p, admin: true })],
      ["champ requis manquant", (p) => ({ ...p, machine: { hostname: "PC" } })],
      ["type inattendu", (p) => ((mageOf(p).level = "VALEUR-SECRETE" as never), p)],
      ["uuid invalide", (p) => ({ ...p, machine: { uuid: "VALEUR-SECRETE", hostname: "PC" } })],
      ["guid invalide", (p) => ((mageOf(p).guid = "VALEUR SECRETE'; drop table characters;--"), p)],
      ["or négatif", (p) => ((mageOf(p).moneyCopper = -1), p)],
      ["emplacement hors limites", (p) => ((mageOf(p).gear[0].slot = 20), p)],
      ["octet nul", (p) => ((mageOf(p).name = "VALEUR\u0000SECRETE"), p)],
      ["nom trop long", (p) => ((mageOf(p).name = "VALEUR-SECRETE".repeat(20)), p)],
      ["pas un objet", () => ["VALEUR-SECRETE"]],
    ];

    for (const [label, mutate] of cases) {
      const { status, json } = await send(mutate(clone()));
      assert.equal(status, 422, label);
      assert.equal(json.code, "invalid_payload", label);
      assert.ok(Array.isArray(json.issues) && json.issues.length > 0, label);
      assert.ok(!JSON.stringify(json).includes("SECRETE"), label);
    }

    assert.equal(await count(t.characters), 0);
    assert.ok(!JSON.stringify(logs).includes("SECRETE"));
  });

  test("JSON illisible : 400 ; mauvais type de contenu : 415", async () => {
    assert.equal((await send(null, { raw: "{ pas du json" })).status, 400);
    assert.equal((await send(null, { raw: "" })).status, 400);
    assert.equal((await send(clone(), { contentType: "text/plain" })).status, 415);
    assert.equal(await count(t.characters), 0);
  });

  test("document trop volumineux : 413, avec ou sans Content-Length honnête", async () => {
    const declared = await send(clone(), { maxBodyBytes: 1024 });
    assert.equal(declared.status, 413);

    const lying = await send(clone(), { maxBodyBytes: 1024, headers: { "content-length": "10" } });
    assert.equal(lying.status, 413);
    assert.equal(await count(t.characters), 0);
  });

  test("version de document inconnue : 422 explicite", async () => {
    const { status, json } = await send({ ...clone(), schemaVersion: 2 });

    assert.equal(status, 422);
    assert.equal(json.code, "unsupported_schema_version");
    assert.deepEqual(json.supported, [1]);
    assert.equal(await count(t.characters), 0);
  });

  test("un jeton lié à une machine est refusé pour une autre : 403", async () => {
    await ok(clone());

    const { status, json } = await send(fromMachine(clone(), PC2, "PC-INTRUS"));

    assert.equal(status, 403);
    assert.equal(json.code, "token_machine_mismatch");
    assert.equal(await count(t.machines), 1);
  });

  test("les échecs d'authentification répétés sont limités : 429", async () => {
    const limiter = new RateLimiter(() => NOW.getTime());
    for (let i = 0; i < 10; i++) assert.equal((await send(clone(), { token: null, limiter })).status, 401);

    const blocked = await send(clone(), { limiter });

    assert.equal(blocked.status, 429);
    assert.equal(blocked.response.headers.get("retry-after"), "300");
    assert.equal(await count(t.characters), 0);
  });
});

describe("mise à jour d'un personnage existant", () => {
  test("une progression met à jour le personnage et crée un snapshot", async () => {
    await ok(clone());
    const next = clone();
    const mage = mageOf(next);
    Object.assign(mage, { level: 26, xp: 120, moneyCopper: 95000, lastSeen: mage.lastSeen + 3600, zone: "Forêt d'Elwynn" });
    mage.professions[0].rank = 95;
    mage.gear = mage.gear.filter((g) => g.slot !== 5);

    const result = await ok(next);

    assert.deepEqual([result.charactersUpdated, result.charactersUnchanged, result.charactersCreated, result.snapshotsCreated], [1, 5, 0, 1]);
    const stored = await character(MAGE);
    assert.deepEqual([stored.level, stored.xp, stored.moneyCopper, stored.zone], [26, 120, 95000, "Forêt d'Elwynn"]);
    assert.equal(await count(t.characters), 6);
    const equipment = await database.db.select({ slot: t.characterEquipment.slot }).from(t.characterEquipment).where(eq(t.characterEquipment.characterId, stored.id));
    assert.ok(!equipment.some((e) => e.slot === 5));
    assert.equal(equipment.length, 13);
    const snapshots = await database.db
      .select({ level: t.characterSnapshots.level, money: t.characterSnapshots.moneyCopper })
      .from(t.characterSnapshots)
      .where(eq(t.characterSnapshots.characterId, stored.id))
      .orderBy(asc(t.characterSnapshots.capturedAt));
    assert.deepEqual(snapshots, [{ level: 25, money: 80964 }, { level: 26, money: 95000 }]);
  });

  test("une connexion sans progression met à jour sans créer de snapshot", async () => {
    await ok(clone());
    const next = clone();
    const mage = mageOf(next);
    Object.assign(mage, { lastSeen: mage.lastSeen + 60, statsAt: mage.lastSeen + 60, restedXp: 500, zone: "Ironforge" });

    const result = await ok(next);

    assert.deepEqual([result.charactersUpdated, result.snapshotsCreated], [1, 0]);
    assert.equal((await character(MAGE)).zone, "Ironforge");
    assert.equal(await count(t.characterSnapshots), 6);
  });

  test("le retour à un état antérieur est historisé", async () => {
    await ok(clone());
    for (const [offset, money] of [[100, 200000], [200, 80964]] as const) {
      const next = clone();
      Object.assign(mageOf(next), { lastSeen: mageOf(BASE).lastSeen + offset, moneyCopper: money });
      await ok(next);
    }

    const stored = await character(MAGE);
    const history = await database.db
      .select({ money: t.characterSnapshots.moneyCopper })
      .from(t.characterSnapshots)
      .where(eq(t.characterSnapshots.characterId, stored.id))
      .orderBy(asc(t.characterSnapshots.capturedAt));
    assert.deepEqual(history.map((h) => h.money), [80964, 200000, 80964]);
  });

  test("un personnage absent du fichier suivant n'est jamais supprimé", async () => {
    await ok(clone());
    const next = clone();
    next.accounts[0].characters = next.accounts[0].characters.filter((c) => c.guid !== MAGE);

    const result = await ok(next);

    assert.equal(result.charactersReceived, 5);
    assert.equal(await count(t.characters), 6);
    assert.ok(await character(MAGE));
  });

  test("un nouveau personnage est ajouté sans toucher aux autres", async () => {
    await ok(clone());
    const next = clone();
    next.accounts[1].characters.push({
      ...structuredClone(next.accounts[1].characters[0]),
      guid: "Player-9999-000000FF",
      name: "Nouveau D'Été 日本語 🐉",
      realm: "ClassicBetaPvP1",
    });

    const result = await ok(next);

    assert.deepEqual([result.charactersCreated, result.charactersUnchanged], [1, 6]);
    assert.equal((await character("Player-9999-000000FF")).name, "Nouveau D'Été 日本語 🐉");
    assert.equal(await count(t.realms), 2);
  });
});

describe("plusieurs PC", () => {
  test("PC1 envoie le compte A, PC2 le compte B", async () => {
    const token2 = (await createAgentToken(database.db, "PC 2")).token;

    await ok(onlyAccount(0));
    await ok(fromMachine(onlyAccount(1), PC2, "PC-2"), { token: token2 });

    assert.deepEqual([await count(t.machines), await count(t.wowAccounts), await count(t.characters)], [2, 2, 6]);
    assert.equal(await count(t.machineAccounts), 2);
  });

  test("le même compte vu depuis deux PC reste unique", async () => {
    const token2 = (await createAgentToken(database.db, "PC 2")).token;

    await ok(onlyAccount(0));
    const result = await ok(fromMachine(onlyAccount(0), PC2, "PC-2"), { token: token2 });

    assert.deepEqual([result.charactersCreated, result.charactersUnchanged], [0, 4]);
    assert.deepEqual([await count(t.machines), await count(t.wowAccounts), await count(t.characters)], [2, 1, 4]);
    assert.equal(await count(t.machineAccounts), 2);
    assert.equal(await count(t.characterMachines), 8);
    assert.equal(await count(t.characterSnapshots), 4);
  });

  test("un PC détenant un fichier plus ancien n'écrase pas un état plus récent", async () => {
    const token2 = (await createAgentToken(database.db, "PC 2")).token;
    await ok(onlyAccount(0));
    const older = fromMachine(onlyAccount(0), PC2, "PC-2");
    Object.assign(mageOf(older), { lastSeen: mageOf(BASE).lastSeen - 86400, level: 20, moneyCopper: 5 });

    const result = await ok(older, { token: token2 });

    assert.deepEqual([result.charactersStale, result.charactersUnchanged, result.charactersUpdated], [1, 3, 0]);
    const stored = await character(MAGE);
    assert.deepEqual([stored.level, stored.moneyCopper], [25, 80964]);
    assert.equal(await count(t.characterSnapshots), 4);
  });

  test("le PC le plus à jour l'emporte, et la banque connue d'un autre PC est conservée", async () => {
    const token2 = (await createAgentToken(database.db, "PC 2")).token;
    await ok(onlyAccount(0));
    const stored = await character(MAGE);
    const bankBefore = await database.db.select().from(t.characterItems).where(eq(t.characterItems.characterId, stored.id));

    const newer = fromMachine(onlyAccount(0), PC2, "PC-2");
    const mage = mageOf(newer);
    Object.assign(mage, { lastSeen: mage.lastSeen + 7200, level: 27 });
    delete mage.bank; // ce PC n'a jamais ouvert la banque

    const result = await ok(newer, { token: token2 });

    assert.equal(result.charactersUpdated, 1);
    const after = await character(MAGE);
    assert.equal(after.level, 27);
    assert.equal(after.bankAt?.getTime(), 1791111262_000);
    assert.deepEqual([after.bankSlotsUsed, after.bankSlotsTotal], [52, 54]);
    const bankAfter = await database.db.select().from(t.characterItems).where(eq(t.characterItems.characterId, stored.id));
    assert.equal(bankAfter.filter((i) => i.location === "bank").length, bankBefore.filter((i) => i.location === "bank").length);
    const [machine2] = await database.db.select().from(t.machines).where(eq(t.machines.machineUuid, PC2));
    assert.equal(after.lastMachineId, machine2.id);
  });

  test("une banque plus ancienne que celle connue n'est pas appliquée", async () => {
    await ok(onlyAccount(0));
    const next = onlyAccount(0);
    const mage = mageOf(next);
    Object.assign(mage, { lastSeen: mage.lastSeen + 60 });
    mage.bank = { at: mage.bank!.at - 5000, slotsUsed: 1, slotsTotal: 54, items: [{ key: "159", count: 1 }] };

    await ok(next);

    const after = await character(MAGE);
    assert.deepEqual([after.bankSlotsUsed, after.bankAt?.getTime()], [52, 1791111262_000]);
  });
});

describe("transactions et contraintes", () => {
  test("une erreur en cours de traitement annule toute la synchronisation", async () => {
    const broken = clone();
    // Contourne la validation pour provoquer une violation de contrainte après plusieurs écritures.
    broken.accounts[1].characters[1].gear[0].slot = 25;
    const [{ id: tokenId }] = await database.db.select({ id: t.agentTokens.id }).from(t.agentTokens);

    await assert.rejects(processSync(database.db, broken, { tokenId, requestId: "test", now: NOW }));

    assert.deepEqual(
      [await count(t.machines), await count(t.wowAccounts), await count(t.characters), await count(t.items), await count(t.syncRuns)],
      [0, 0, 0, 0, 0],
    );
  });

  test("une panne interne répond 500, journalise l'échec et ne divulgue rien", async () => {
    const failing = new Proxy(database.db, {
      get: (target, property) =>
        property === "transaction" ? () => Promise.reject(new Error("panne simulée")) : Reflect.get(target, property),
    });

    const response = await handleSyncRequest(
      new Request("https://wow.example.test/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(clone()),
      }),
      { db: failing, rateLimiter: new RateLimiter(), now: () => NOW, log: (event) => logs.push(event) },
    );

    assert.equal(response.status, 500);
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(json.code, "internal_error");
    assert.ok(!JSON.stringify(json).includes("panne simulée"));
    const [run] = await database.db.select().from(t.syncRuns);
    assert.deepEqual([run.status, run.errorsCount], ["failed", 1]);
    assert.equal(await count(t.syncErrors), 1);
    assert.equal(await count(t.characters), 0);
  });

  test("contraintes d'unicité, de clé étrangère et de validation", async () => {
    await ok(clone());
    const mage = await character(MAGE);
    const columns = { ...mage, id: undefined };

    await rejectedBy("characters_guid_unique", database.db.insert(t.characters).values({ ...columns, guid: MAGE }));
    await rejectedBy("characters_account_id_wow_accounts_id_fk", database.db.insert(t.characters).values({ ...columns, guid: "Player-9999-FK", accountId: 999_999 }));
    await rejectedBy("character_equipment_slot_check", database.db.insert(t.characterEquipment).values({ characterId: mage.id, slot: 20 }));
    await rejectedBy(
      "character_items_location_check",
      database.db.insert(t.characterItems).values({ characterId: mage.id, location: "poche", itemKey: "1", quantity: 1 }),
    );
    await rejectedBy("characters_account_id_wow_accounts_id_fk", database.db.delete(t.wowAccounts).where(eq(t.wowAccounts.id, mage.accountId)));
  });

  test("supprimer un personnage supprime ses données filles", async () => {
    await ok(onlyAccount(1));
    assert.ok((await count(t.characterEquipment)) > 0);

    await database.db.delete(t.characters);

    const remaining = await totals();
    assert.deepEqual(
      [remaining.professions, remaining.equipment, remaining.reputations, remaining.stats, remaining.items, remaining.snapshots],
      [0, 0, 0, 0, 0, 0],
    );
  });

  test("les avertissements de l'agent sont conservés avec la synchronisation", async () => {
    const payload = clone();
    payload.accounts[0].warnings = ["champ de personnage inconnu ignoré : talents"];

    const result = await ok(payload);

    const [warning] = await database.db.select().from(t.syncErrors);
    assert.deepEqual([warning.syncRunId, warning.code, warning.message], [result.runId, "agent_warning", "champ de personnage inconnu ignoré : talents"]);
  });
});
