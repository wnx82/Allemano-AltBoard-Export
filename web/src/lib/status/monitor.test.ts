import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStatusConfig, type Target } from "./config";
import { MANUAL_COOLDOWN_MS, nextDelay, RETENTION_MS, StatusMonitor, type CheckRecord } from "./monitor";
import type { ProbeOptions, ProbeResult } from "./probe";

const CONFIGURED = { WOW_STATUS_AUTH_TARGETS: "login.example.test:1119", WOW_STATUS_GAME_TARGETS: "192.0.2.10:3724,192.0.2.11:3724" };

const UP: ProbeResult = { outcome: "connected", latencyMs: 20, error: null };
const REFUSED: ProbeResult = { outcome: "refused", latencyMs: null, error: "ECONNREFUSED" };

type Timer = { callback: () => void; delayMs: number; cleared: boolean };

/** Moniteur dont l'horloge, les minuteurs, les sondes et la base sont entre les mains du test. */
function harness(env: Record<string, string> = CONFIGURED) {
  const state = {
    time: Date.parse("2026-10-08T12:00:00Z"),
    timers: [] as Timer[],
    probes: [] as { target: Target; options: ProbeOptions }[],
    records: [] as CheckRecord[][],
    pruned: [] as Date[],
    logs: [] as Record<string, unknown>[],
    answer: (() => UP) as (target: Target) => ProbeResult | Promise<ProbeResult>,
    storeFails: false,
  };
  const monitor = new StatusMonitor({
    config: loadStatusConfig(env),
    probe: async (target, options) => {
      state.probes.push({ target, options });
      return state.answer(target);
    },
    store: {
      record: async (checks) => {
        if (state.storeFails) throw new Error("base indisponible");
        state.records.push(checks);
      },
      prune: async (before) => {
        state.pruned.push(before);
      },
    },
    now: () => new Date(state.time),
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      state.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as Timer).cleared = true;
    },
    log: (event) => state.logs.push(event),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  /** Déclenche le dernier minuteur armé, comme si son délai était écoulé. */
  const fire = async () => {
    const timer = state.timers.at(-1)!;
    assert.equal(timer.cleared, false);
    state.time += timer.delayMs;
    timer.callback();
    await settle();
  };
  return { state, monitor, fire, settle };
}

const probed = (state: { probes: { target: Target }[] }, host: string) => state.probes.filter((probe) => probe.target.host === host).length;

test("sans adresse configurée, rien ne démarre et rien n'est sondé", async () => {
  const { state, monitor } = harness({});

  monitor.start();

  assert.equal(monitor.active, false);
  assert.equal(state.timers.length, 0);
  assert.equal(await monitor.refresh(), "unconfigured");
  assert.equal(state.probes.length, 0);
  assert.deepEqual(state.records, []);
});

test("chaque tour contrôle les services séparément et enregistre un résultat par service", async () => {
  const { state, monitor, fire } = harness();
  state.answer = (target) => (target.host === "192.0.2.11" ? REFUSED : UP);

  monitor.start();
  monitor.start();
  assert.equal(state.timers.length, 1, "un second start ne double pas le minuteur");
  await fire();

  assert.equal(state.probes.length, 3);
  assert.ok(state.probes.every((probe) => probe.options.timeoutMs === 3_000 && probe.options.signal));
  const [checks] = state.records;
  assert.deepEqual(
    checks.map((check) => [check.service, check.status, check.outcome, check.targetsUp, check.targetsTotal, check.source]),
    [
      ["auth", "up", "ok", 1, 1, "tcp"],
      ["game", "degraded", "partial", 1, 2, "tcp"],
    ],
  );
  assert.equal(checks[0].checkedAt.toISOString(), "2026-10-08T12:00:00.000Z");
  // Le passage suivant est armé à l'intervalle configuré.
  assert.equal(state.timers.length, 2);
  assert.equal(state.timers[1].delayMs, 300_000);
});

test("contrôles simultanés : une demande manuelle rejoint le tour en cours", async () => {
  const { state, monitor, settle } = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  state.answer = async () => {
    await gate;
    return UP;
  };

  monitor.start();
  state.timers[0].callback();
  await settle();
  const first = monitor.refresh();
  const second = monitor.refresh();
  release();

  assert.deepEqual(await Promise.all([first, second]), ["joined", "joined"]);
  assert.equal(state.probes.length, 3, "chaque adresse n'a été sondée qu'une fois");
  assert.equal(state.records.length, 1);
});

test("rafraîchissement manuel : contrôle immédiat, puis un délai entre deux demandes", async () => {
  const { state, monitor } = harness();

  assert.equal(await monitor.refresh(), "checked");
  assert.equal(state.probes.length, 3);
  assert.equal(state.records.length, 1);

  assert.equal(await monitor.refresh(), "recent");
  assert.equal(state.probes.length, 3);

  state.time += MANUAL_COOLDOWN_MS;
  assert.equal(await monitor.refresh(), "checked");
  assert.equal(state.probes.length, 6);
  // Une demande manuelle n'arme aucun minuteur : elle ne démarre pas la surveillance.
  assert.equal(state.timers.length, 0);
});

test("backoff : un service en échec répété est contrôlé de moins en moins souvent", async () => {
  // Intervalle d'une minute : à celui par défaut, déjà au plafond, rien ne s'espace.
  const { state, monitor, fire } = harness({ ...CONFIGURED, WOW_STATUS_INTERVAL_SECONDS: "60" });
  state.answer = (target) => (target.host === "login.example.test" ? REFUSED : UP);

  monitor.start();
  const authProbes: number[] = [];
  // Seize passages : un à l'instant zéro, puis un par minute.
  for (let tick = 0; tick < 16; tick++) {
    await fire();
    authProbes.push(probed(state, "login.example.test"));
  }

  // Trois échecs au rythme normal, puis 2, 4 et 5 minutes d'écart (plafond).
  assert.deepEqual(authProbes, [1, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6]);
  // Le service qui répond garde son rythme.
  assert.equal(probed(state, "192.0.2.10"), 16);

  // Une demande manuelle passe outre, et un succès rétablit le rythme normal.
  state.answer = () => UP;
  state.time += MANUAL_COOLDOWN_MS;
  assert.equal(await monitor.refresh(), "checked");
  assert.equal(probed(state, "login.example.test"), 7);
  await fire();
  await fire();
  assert.equal(probed(state, "login.example.test"), 9);
});

test("le délai de backoff double jusqu'au plafond de cinq minutes", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 50].map((failures) => nextDelay(failures, 60_000)),
    [60_000, 60_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000],
  );
  // Un intervalle déjà plus long que le plafond n'est jamais raccourci.
  assert.equal(nextDelay(10, 600_000), 600_000);
  // L'intervalle par défaut vaut le plafond : un service en échec garde son rythme.
  assert.deepEqual([0, 3, 50].map((failures) => nextDelay(failures, 300_000)), [300_000, 300_000, 300_000]);
});

test("arrêt : minuteur annulé, sondes interrompues, rien n'est enregistré ni réarmé", async () => {
  const { state, monitor, settle } = harness();
  // Sonde qui ne finit qu'à l'interruption, comme une connexion en attente.
  const pending: Promise<ProbeResult>[] = [];
  state.answer = (target) => {
    const options = state.probes.findLast((probe) => probe.target === target)!.options;
    const result = new Promise<ProbeResult>((resolve) =>
      options.signal!.addEventListener("abort", () => resolve({ outcome: "error", latencyMs: null, error: "ABORTED" })),
    );
    pending.push(result);
    return result;
  };

  monitor.start();
  state.timers[0].callback();
  await settle();
  assert.equal(pending.length, 3);

  await monitor.stop();

  assert.equal(monitor.active, false);
  assert.ok(state.probes.every((probe) => probe.options.signal!.aborted));
  assert.deepEqual(state.records, []);
  await settle();
  assert.equal(state.timers.length, 1, "aucun nouveau passage n'est armé après l'arrêt");

  // Arrêt au repos : le minuteur en attente est annulé.
  const idle = harness();
  idle.monitor.start();
  await idle.fire();
  await idle.monitor.stop();
  assert.equal(idle.state.timers.at(-1)!.cleared, true);
});

test("base indisponible : la mesure est perdue, la surveillance continue", async () => {
  const { state, monitor, fire } = harness();
  state.storeFails = true;

  monitor.start();
  await fire();

  assert.deepEqual(state.logs, [{ event: "server_status.store_failed" }]);
  assert.equal(state.timers.length, 2);

  state.storeFails = false;
  await fire();
  assert.equal(state.records.length, 1);
});

test("une sonde qui lève une exception compte comme une erreur, pas comme un arrêt", async () => {
  const { state, monitor, fire } = harness({ WOW_STATUS_AUTH_TARGETS: "login.example.test:1119" });
  state.answer = () => {
    throw new Error("inattendu");
  };

  monitor.start();
  await fire();

  assert.deepEqual([state.records[0][0].status, state.records[0][0].outcome], ["unknown", "error"]);
  assert.equal(state.timers.length, 2);
});

test("les changements de statut sont journalisés, pas les contrôles", async () => {
  const { state, monitor, fire } = harness({ WOW_STATUS_AUTH_TARGETS: "login.example.test:1119" });

  monitor.start();
  await fire();
  await fire();
  assert.deepEqual(state.logs, []);

  state.answer = () => REFUSED;
  await fire();
  assert.deepEqual(state.logs, [{ event: "server_status.changed", service: "auth", from: "up", to: "down", outcome: "refused" }]);
});

test("l'historique est purgé au-delà de la conservation, une fois par heure au plus", async () => {
  const { state, monitor, fire } = harness({ WOW_STATUS_AUTH_TARGETS: "login.example.test:1119" });

  monitor.start();
  await fire();
  assert.deepEqual(state.pruned, [new Date(Date.parse("2026-10-08T12:00:00Z") - RETENTION_MS)]);

  // Onze passages à cinq minutes d'écart : cinquante-cinq minutes après la première purge.
  for (let tick = 0; tick < 11; tick++) await fire();
  assert.equal(state.pruned.length, 1);
  await fire();
  assert.equal(state.pruned.length, 2);
});
