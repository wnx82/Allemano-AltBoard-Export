import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLevelTimes, formatDuration } from "./level-times";

const at = (iso: string) => new Date(iso);
const row = (level: number, playedSeconds: number | null, wallSeconds: number | null = null) => ({
  level,
  playedSeconds,
  wallSeconds,
  reachedAt: at("2026-10-04T12:00:00Z"),
  zone: "Forêt d'Elwynn",
});
const playtime = (currentLevel: number | null, total: number | null, start: number | null) => ({
  totalSeconds: total,
  measuredAt: at("2026-10-04T15:00:00Z"),
  currentLevel,
  currentLevelStartSeconds: start,
  currentLevelStartedAt: at("2026-10-04T13:00:00Z"),
});

test("les niveaux terminés sont triés et le niveau en cours est ajouté à la fin", () => {
  const levels = buildLevelTimes([row(24, 5400, 90000), row(23, 3600)], playtime(25, 100_000, 97_000), 25);

  assert.deepEqual(
    levels.map((entry) => [entry.level, entry.playedSeconds, entry.wallSeconds, entry.current]),
    [
      [23, 3600, null, false],
      [24, 5400, 90000, false],
      [25, 3000, 7200, true],
    ],
  );
  assert.equal(levels[0].reachedAt, "2026-10-04T12:00:00.000Z");
  assert.equal(levels[2].reachedAt, null);
});

test("un niveau gagné sans mesure reste présent, sans durée inventée", () => {
  const levels = buildLevelTimes([row(10, null), row(11, 1200)], null, 12);

  assert.deepEqual(levels.map((entry) => [entry.level, entry.playedSeconds]), [
    [10, null],
    [11, 1200],
  ]);
});

test("le niveau en cours n'est affiché que s'il est connu et cohérent", () => {
  assert.equal(buildLevelTimes([], null, 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(null, 100, 50), 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(25, null, 50), 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(25, 100, null), 25).length, 0);
  // Relevé antérieur au passage de niveau : il décrit le niveau 24, plus le niveau actuel.
  assert.equal(buildLevelTimes([], playtime(24, 100, 50), 25).length, 0);
  // Niveau du personnage inconnu : le relevé fait foi.
  assert.deepEqual(buildLevelTimes([], playtime(24, 100, 50), null).map((entry) => [entry.level, entry.playedSeconds]), [[24, 50]]);
  // Déjà terminé : pas de doublon.
  assert.equal(buildLevelTimes([row(25, 900)], playtime(25, 100, 50), 25).length, 1);
  // Horloge incohérente : jamais de durée négative.
  assert.equal(buildLevelTimes([], playtime(25, 50, 100), 25)[0].playedSeconds, 0);
});

test("les durées sont lisibles à toutes les échelles", () => {
  assert.deepEqual(
    [0, 45, 60, 725, 3600, 11_100, 86_399, 86_400, 187_200].map(formatDuration),
    ["0 s", "45 s", "1 min", "12 min", "1 h 00", "3 h 05", "23 h 59", "1 j 0 h", "2 j 4 h"],
  );
  assert.equal(formatDuration(null), "—");
});
