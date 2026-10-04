import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessions, sessionTagLabel, summarizeSessions } from "./sessions";

const row = (startedAt: string, durationSeconds: number | null, xpGained: number | null, inProgress = false) => ({
  startedAt: new Date(startedAt),
  stoppedAt: durationSeconds === null ? null : new Date(new Date(startedAt).getTime() + durationSeconds * 1000),
  durationSeconds,
  xpGained,
  levels: 0,
  zone: "Loch Modan",
  tag: "Leveling",
  inProgress,
});

test("les sessions sont triées par début et l'expérience par heure est calculée", () => {
  const sessions = buildSessions([row("2026-10-04T18:00:00Z", 3600, 12_000), row("2026-10-03T18:00:00Z", 1800, 4_000)]);

  assert.deepEqual(
    sessions.map((session) => [session.startedAt, session.xpPerHour, session.current]),
    [
      ["2026-10-03T18:00:00.000Z", 8_000, false],
      ["2026-10-04T18:00:00.000Z", 12_000, false],
    ],
  );
  assert.equal(sessions[1].stoppedAt, "2026-10-04T19:00:00.000Z");
});

test("l'expérience par heure n'est pas calculée sans mesure fiable", () => {
  const [unknownDuration, tooShort, unknownXp, idle] = buildSessions([
    row("2026-10-01T10:00:00Z", null, 500),
    row("2026-10-02T10:00:00Z", 59, 500),
    row("2026-10-03T10:00:00Z", 3600, null),
    row("2026-10-04T10:00:00Z", 3600, 0),
  ]);

  assert.deepEqual([unknownDuration.xpPerHour, tooShort.xpPerHour, unknownXp.xpPerHour], [null, null, null]);
  // Une heure sans expérience est une mesure, pas une absence.
  assert.equal(idle.xpPerHour, 0);
});

test("seule la dernière session peut être en cours", () => {
  const sessions = buildSessions([row("2026-10-02T10:00:00Z", 600, 100, true), row("2026-10-04T10:00:00Z", 600, 100, true), row("2026-10-03T10:00:00Z", 600, 100)]);

  assert.deepEqual(
    sessions.map((session) => session.current),
    [false, false, true],
  );
  assert.equal(buildSessions([row("2026-10-02T10:00:00Z", 600, 100, true), row("2026-10-03T10:00:00Z", 600, 100)])[1].current, false);
});

test("les totaux ne comptent que les sessions entièrement mesurées", () => {
  const sessions = buildSessions([row("2026-10-01T10:00:00Z", 3600, 9_000), row("2026-10-02T10:00:00Z", null, 5_000), row("2026-10-03T10:00:00Z", 1800, 3_000), row("2026-10-04T10:00:00Z", 600, null)]);

  assert.deepEqual(summarizeSessions(sessions), { xpGained: 12_000, durationSeconds: 5400, xpPerHour: 8_000 });
  assert.deepEqual(summarizeSessions([]), { xpGained: 0, durationSeconds: 0, xpPerHour: null });
});

test("les étiquettes de l'addon sont traduites, les autres rendues telles quelles", () => {
  assert.equal(sessionTagLabel("Leveling"), "Montée de niveau");
  assert.equal(sessionTagLabel("Dungeon"), "Donjon");
  assert.equal(sessionTagLabel("Ma session"), "Ma session");
  assert.equal(sessionTagLabel(null), null);
});
