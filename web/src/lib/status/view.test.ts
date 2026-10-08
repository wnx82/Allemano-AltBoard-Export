import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStatusConfig } from "./config";
import type { HourBucket } from "./store";
import { buildAvailability, buildHours, buildTransitions, MIN_MEASURED_SECONDS } from "./view";

const NOW = new Date("2026-10-08T12:20:00Z");

const bucket = (hour: string, availableSeconds: number, downSeconds = 0, degradedSeconds = 0): HourBucket => ({
  service: "auth",
  hour: new Date(hour),
  availableSeconds,
  degradedSeconds,
  downSeconds,
});

test("aucun pourcentage tant que l'échantillon est insuffisant", () => {
  assert.deepEqual(buildAvailability([], "24h", NOW), { window: "24h", percent: null, measuredSeconds: 0, downSeconds: 0 });

  const short = buildAvailability([bucket("2026-10-08T12:00:00Z", MIN_MEASURED_SECONDS["24h"] - 1)], "24h", NOW);
  assert.equal(short.percent, null);
  assert.equal(short.measuredSeconds, MIN_MEASURED_SECONDS["24h"] - 1);

  assert.equal(buildAvailability([bucket("2026-10-08T12:00:00Z", MIN_MEASURED_SECONDS["24h"])], "24h", NOW).percent, 100);
});

test("la disponibilité est la part du temps mesuré où le service répondait", () => {
  const buckets = [bucket("2026-10-08T10:00:00Z", 3_600), bucket("2026-10-08T11:00:00Z", 2_700, 900), bucket("2026-10-08T12:00:00Z", 1_200)];

  assert.deepEqual(buildAvailability(buckets, "24h", NOW), { window: "24h", percent: (7_500 / 8_400) * 100, measuredSeconds: 8_400, downSeconds: 900 });
});

test("sept jours ne s'affichent qu'avec plus d'un jour de mesures, et chaque fenêtre ignore ce qui la précède", () => {
  const today = [bucket("2026-10-08T11:00:00Z", 3_600)];
  assert.equal(buildAvailability(today, "24h", NOW).percent, 100);
  assert.equal(buildAvailability(today, "7d", NOW).percent, null);

  const week = Array.from({ length: 30 }, (_, index) => bucket(new Date(Date.parse("2026-10-06T00:00:00Z") + index * 3_600_000).toISOString(), 3_600));
  // La première heure de la série était entièrement en panne.
  week[0] = bucket("2026-10-06T00:00:00Z", 0, 3_600);
  const sevenDays = buildAvailability(week, "7d", NOW);
  assert.equal(sevenDays.measuredSeconds, 30 * 3_600);
  assert.equal(sevenDays.percent, (29 / 30) * 100);

  // Fenêtre de 24 heures pleines : de 13:00 la veille à l'heure en cours.
  const edges = [bucket("2026-10-07T12:00:00Z", 0, 3_600), bucket("2026-10-07T13:00:00Z", 3_600)];
  assert.deepEqual([buildAvailability(edges, "24h", NOW).measuredSeconds, buildAvailability(edges, "24h", NOW).downSeconds], [3_600, 0]);
  // Même règle à sept jours : 167 heures pleines avant l'heure en cours.
  const old = [bucket("2026-10-01T12:00:00Z", 0, 3_600), ...week];
  assert.equal(buildAvailability(old, "7d", NOW).measuredSeconds, 30 * 3_600);
});

test("la frise couvre 24 heures et montre le pire statut de chaque heure", () => {
  const hours = buildHours(
    [bucket("2026-10-08T12:00:00Z", 1_200), bucket("2026-10-08T11:00:00Z", 3_000, 600), bucket("2026-10-08T10:00:00Z", 3_600, 0, 120), bucket("2026-10-07T12:00:00Z", 3_600)],
    NOW,
  );

  assert.equal(hours.length, 24);
  assert.equal(hours[0].start, "2026-10-07T13:00:00.000Z");
  assert.equal(hours.at(-1)!.start, "2026-10-08T12:00:00.000Z");
  assert.deepEqual(hours.slice(-4).map((cell) => cell.status), [null, "degraded", "down", "up"]);
  assert.deepEqual(hours.at(-2), { start: "2026-10-08T11:00:00.000Z", status: "down", availableSeconds: 3_000, downSeconds: 600 });
  // Vingt heures sans mesure : ni en ligne, ni en panne.
  assert.equal(hours.filter((cell) => cell.status === null).length, 21);
});

test("un changement est décrit avec le constat du nouvel état", () => {
  const config = loadStatusConfig({});
  const row = { checkedAt: new Date("2026-10-08T10:02:00Z"), latencyMs: null, targetsUp: 0, targetsTotal: 1, error: "ECONNREFUSED" };

  const transitions = buildTransitions(
    [
      { ...row, service: "auth", previous: "up", status: "down", outcome: "refused" },
      // Valeurs étrangères au modèle : rien n'est inventé à leur place.
      { ...row, service: "auth", previous: "maintenance", status: "up", outcome: "ok", targetsUp: 1 },
      { ...row, service: "chat", previous: "up", status: "down", outcome: "refused" },
    ],
    config,
  );

  assert.deepEqual(transitions, [
    { at: "2026-10-08T10:02:00.000Z", service: "auth", label: "Authentification Blizzard", from: "up", to: "down", detail: "Connexion refusée : panne confirmée par le serveur visé" },
    { at: "2026-10-08T10:02:00.000Z", service: "auth", label: "Authentification Blizzard", from: "unknown", to: "up", detail: "Connexion acceptée" },
  ]);
});
