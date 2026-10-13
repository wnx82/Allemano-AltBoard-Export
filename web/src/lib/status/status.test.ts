import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProbeResult } from "./probe";
import { describeOutcome, evaluateService, formatCheckTime, formatEvery, formatLatency, serviceLabel } from "./status";

const connected = (latencyMs: number): ProbeResult => ({ outcome: "connected", latencyMs, error: null });
const refused: ProbeResult = { outcome: "refused", latencyMs: null, error: "ECONNREFUSED" };
const timeout: ProbeResult = { outcome: "timeout", latencyMs: null, error: null };
const dns: ProbeResult = { outcome: "dns", latencyMs: null, error: "ENOTFOUND" };
const network: ProbeResult = { outcome: "network", latencyMs: null, error: "ENETUNREACH" };

const LIMITS = { timeoutMs: 3_000, degradedMs: 400 };

test("en ligne : toutes les adresses répondent sous le seuil", () => {
  assert.deepEqual(evaluateService([connected(32), connected(24)], 400), {
    status: "up",
    outcome: "ok",
    latencyMs: 24,
    targetsUp: 2,
    targetsTotal: 2,
    error: null,
  });
});

test("dégradé : réponse lente, ou une partie seulement des adresses", () => {
  const slow = evaluateService([connected(400)], 400);
  assert.deepEqual([slow.status, slow.outcome, slow.latencyMs], ["degraded", "slow", 400]);

  const partial = evaluateService([connected(30), timeout, refused], 400);
  assert.deepEqual([partial.status, partial.outcome, partial.latencyMs, partial.targetsUp, partial.targetsTotal], ["degraded", "partial", 30, 1, 3]);
});

test("hors ligne : refus et délai dépassé restent distincts, le refus prime", () => {
  assert.deepEqual([evaluateService([refused], 400).status, evaluateService([refused], 400).outcome], ["down", "refused"]);
  assert.deepEqual([evaluateService([timeout], 400).status, evaluateService([timeout], 400).outcome], ["down", "timeout"]);
  assert.equal(evaluateService([timeout, refused, dns], 400).outcome, "refused");
  assert.equal(evaluateService([timeout], 400).latencyMs, null);
});

test("inconnu : aucune adresse n'a pu être jointe", () => {
  assert.deepEqual([evaluateService([dns], 400).status, evaluateService([dns], 400).outcome], ["unknown", "dns"]);
  assert.deepEqual([evaluateService([network, network], 400).status, evaluateService([network, network], 400).outcome], ["unknown", "network"]);
  const other = evaluateService([{ outcome: "error", latencyMs: null, error: "EPIPE" }], 400);
  assert.deepEqual([other.status, other.outcome, other.error], ["unknown", "error", "EPIPE"]);
  // Un port qui ne répond pas chez l'un, un nom introuvable chez l'autre : la panne est établie.
  assert.equal(evaluateService([dns, timeout], 400).status, "down");
});

test("le constat dit ce que le statut ne dit pas", () => {
  const describe = (results: ProbeResult[]) => describeOutcome(evaluateService(results, LIMITS.degradedMs), LIMITS);

  assert.equal(describe([connected(20)]), "Connexion acceptée");
  assert.equal(describe([connected(20), connected(25)]), "2 adresses sur 2 répondent");
  assert.match(describe([connected(650)]), /650 ms, au-delà du seuil de 400 ms/);
  assert.equal(describe([connected(20), timeout, timeout]), "1 adresse sur 3 répond");
  assert.match(describe([refused]), /panne confirmée/);
  assert.match(describe([timeout]), /Aucune réponse en 3 s : panne probable, non confirmée/);
  assert.match(describe([dns]), /DNS/);
  assert.match(describe([network]), /Réseau injoignable depuis ce serveur/);
  assert.equal(describe([{ outcome: "error", latencyMs: null, error: "EPIPE" }]), "Erreur réseau (EPIPE)");
  // Adresse de la page Paramètres qui ne désigne pas un serveur public : dit en clair, pas en code.
  assert.match(describe([{ outcome: "error", latencyMs: null, error: "EBLOCKED" }]), /^Adresse refusée .* rien n'a été sondé$/);
});

test("les serveurs de jeu portent l'environnement surveillé", () => {
  assert.equal(serviceLabel("game", "Bêta"), "Serveurs de jeu Bêta");
  assert.equal(serviceLabel("game", "EU"), "Serveurs de jeu EU");
  assert.equal(serviceLabel("auth", "Bêta"), "Authentification Blizzard");
});

test("latence et heure sont mises en forme pour la Belgique", () => {
  assert.equal(formatLatency(null), "—");
  assert.equal(formatLatency(32), "32 ms");
  // 14:05:09 UTC = 16:05:09 à Bruxelles, en heure d'été.
  assert.match(formatCheckTime("2026-10-08T14:05:09Z"), /^0?8\/10\/(20)?26.*16:05:09$/);
  // En heure d'hiver, le décalage n'est plus que d'une heure.
  assert.match(formatCheckTime(new Date("2026-12-01T14:05:09Z")), /15:05:09$/);
  assert.equal(formatCheckTime(null), "—");
});

test("le rythme des contrôles se lit en minutes quand il en compte un nombre entier", () => {
  assert.equal(formatEvery(300), "toutes les 5 minutes");
  assert.equal(formatEvery(60), "chaque minute");
  assert.equal(formatEvery(90), "toutes les 90 secondes");
  assert.equal(formatEvery(30), "toutes les 30 secondes");
});
