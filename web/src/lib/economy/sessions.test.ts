import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { cancelFarmSession, compareSessions, endFarmSession, listFarmSessions, startFarmSession } from "./sessions";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");
const GUID = BASE.accounts[0].characters[0].guid;

let database: TestDatabase;
let tokenId: number;
let characterId: number;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  tokenId = (await createAgentToken(database.db, "PC de test")).id;
  await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "start", now: NOW });
  [{ id: characterId }] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.guid, GUID));
});

/** Le même personnage, relevé `seconds` plus tard, avec dix objets 2576 de plus et 50 pa gagnées. */
async function farmFor(seconds: number) {
  const payload = structuredClone(BASE);
  const character = payload.accounts[0].characters[0];
  character.lastSeen += seconds;
  character.bags!.at += seconds;
  const existing = character.bags!.items.find((item) => item.key === "2576");
  if (existing) existing.count += 10;
  else character.bags!.items.push({ key: "2576", count: 10 });
  character.moneyCopper = (character.moneyCopper ?? 0) + 5_000;
  await processSync(database.db, payload, { tokenId, requestId: "end", now: new Date(NOW.getTime() + seconds * 1000) });
}

describe("sessions de farm", () => {
  test("une session mesure la différence d'inventaire entre deux relevés réels", async () => {
    const started = await startFarmSession(database.db, { characterId, label: "Minage", now: NOW });
    assert.equal(started.ok, true);

    // Sans nouveau relevé des sacs, rien n'est mesurable : la session reste ouverte.
    const tooEarly = await endFarmSession(database.db, { sessionId: started.ok ? started.id : 0, now: NOW });
    assert.equal(tooEarly.ok, false);

    await farmFor(1_800);
    const ended = await endFarmSession(database.db, { sessionId: started.ok ? started.id : 0, now: new Date(NOW.getTime() + 1_900_000) });
    assert.equal(ended.ok, true);

    const [session] = await listFarmSessions(database.db, (key) => (key === "2576" ? 95 : null));
    assert.equal(session.label, "Minage");
    assert.equal(session.valuation!.durationSeconds, 1_800);
    assert.equal(session.valuation!.moneyDelta, 5_000);
    assert.deepEqual(session.valuation!.items, [{ itemKey: "2576", delta: 10, unitValue: 95, value: 950 }]);
    assert.equal(session.valuation!.totalValue, 5_950);
    assert.equal(session.valuation!.perHour, 11_900);

    const [byLabel] = compareSessions([session], "label");
    assert.deepEqual([byLabel.label, byLabel.sessions, byLabel.perHour], ["Minage", 1, 11_900]);
  });

  test("une seule session ouverte par personnage, même sous deux démarrages simultanés", async () => {
    const results = await Promise.all([
      startFarmSession(database.db, { characterId, label: null, now: NOW }),
      startFarmSession(database.db, { characterId, label: null, now: NOW }),
    ]);

    assert.deepEqual(results.map((r) => r.ok).toSorted(), [false, true]);
    assert.equal(await countRows(database.db, t.farmSessions), 1);
  });

  test("une session en cours s'abandonne, une session terminée reste", async () => {
    const started = await startFarmSession(database.db, { characterId, label: null, now: NOW });
    const id = started.ok ? started.id : 0;

    assert.equal((await cancelFarmSession(database.db, id)).ok, true);
    assert.equal(await countRows(database.db, t.farmSessions), 0);
    assert.equal(await countRows(database.db, t.farmSessionItems), 0);

    const again = await startFarmSession(database.db, { characterId, label: null, now: NOW });
    await farmFor(600);
    await endFarmSession(database.db, { sessionId: again.ok ? again.id : 0, now: NOW });
    assert.equal((await cancelFarmSession(database.db, again.ok ? again.id : 0)).ok, false);
    assert.equal(await countRows(database.db, t.farmSessions), 1);
  });

  test("personnage inconnu : refusé", async () => {
    const result = await startFarmSession(database.db, { characterId: 999_999, label: null, now: NOW });

    assert.deepEqual(result, { ok: false, error: "Personnage introuvable." });
  });
});
