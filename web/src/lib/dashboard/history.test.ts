import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHistory, describeChanges, type SnapshotLike } from "./history";

const snapshot = (minute: number, values: Partial<SnapshotLike> & { data?: unknown }): SnapshotLike => ({
  capturedAt: new Date(Date.UTC(2026, 9, 4, 12, minute)),
  level: 32,
  moneyCopper: 100_000,
  itemLevel: 42,
  data: { guild: "Les Sans-Souci", professions: [{ skillLine: 197, name: "Couture", rank: 175, max: 225 }], reputations: [] },
  ...values,
});

test("les changements entre deux snapshots sont décrits", () => {
  const changes = describeChanges(
    snapshot(0, {}),
    snapshot(30, {
      level: 33,
      moneyCopper: 143_200,
      itemLevel: 45,
      data: {
        guild: "Les Sans-Souci",
        professions: [
          { skillLine: 197, name: "Couture", rank: 181, max: 225 },
          { skillLine: 333, name: "Enchantement", rank: 1, max: 75 },
        ],
      },
    }),
  );

  assert.deepEqual(
    changes.map((change) => change.text),
    ["Niveau 32 → 33", "Couture 175 → 181", "Nouveau métier : Enchantement (1)", "+4 po 32 pa 0 pc", "Niveau d'objet 42 → 45"],
  );
});

test("une dépense, un changement de palier et un départ de guilde sont décrits", () => {
  const changes = describeChanges(
    snapshot(0, { data: { guild: "Les Sans-Souci", reputations: [{ factionId: 47, name: "Ironforge", reaction: 5, current: 5900 }] } }),
    snapshot(30, { moneyCopper: 99_950, data: { reputations: [{ factionId: 47, name: "Ironforge", reaction: 6, current: 9100 }] } }),
  );

  assert.deepEqual(
    changes.map((change) => change.text),
    ["−50 pc", "Ironforge : Amical → Honoré", "A quitté Les Sans-Souci"],
  );
});

test("des données absentes ne produisent aucun faux changement", () => {
  assert.deepEqual(describeChanges(snapshot(0, { level: null, moneyCopper: null, itemLevel: null, data: null }), snapshot(30, {})), [
    { kind: "profession", text: "Nouveau métier : Couture (175)" },
    { kind: "guild", text: "A rejoint Les Sans-Souci" },
  ]);
  assert.deepEqual(describeChanges(snapshot(0, {}), snapshot(30, {})), []);
  // Un niveau d'objet qui ne change pas à l'affichage (15,94 → 15,90) n'est pas signalé.
  assert.deepEqual(describeChanges(snapshot(0, { itemLevel: 15.94 }), snapshot(30, { itemLevel: 15.9 })), []);
});

test("l'historique va du plus récent au plus ancien et omet les snapshots sans changement", () => {
  const history = buildHistory([snapshot(0, {}), snapshot(10, { level: 33 }), snapshot(20, { level: 33 }), snapshot(30, { level: 34 })]);

  assert.deepEqual(
    history.map((entry) => [entry.at.getUTCMinutes(), entry.changes[0].text]),
    [
      [30, "Niveau 33 → 34"],
      [10, "Niveau 32 → 33"],
    ],
  );
  assert.deepEqual(buildHistory([snapshot(0, {})]), []);
});
