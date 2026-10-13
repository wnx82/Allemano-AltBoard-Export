import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTarget, isConfigured, loadStatusConfig, MAX_TARGETS, parseTarget } from "./config";

test("sans variable, aucun serveur n'est surveillé et les valeurs par défaut s'appliquent", () => {
  const config = loadStatusConfig({});

  assert.deepEqual(config.targets, { auth: [], game: [] });
  assert.equal(isConfigured(config), false);
  assert.deepEqual([config.intervalMs, config.timeoutMs, config.degradedMs], [300_000, 3_000, 400]);
  // Trois intervalles : deux contrôles manqués de suite ne rendent pas encore l'état inconnu.
  assert.equal(config.staleAfterMs, 900_000);
  assert.deepEqual(config.errors, []);
});

test("les adresses sont lues telles que configurées, sans doublon", () => {
  const config = loadStatusConfig({
    WOW_STATUS_AUTH_TARGETS: " Login.Example.test:1119 ",
    WOW_STATUS_GAME_TARGETS: "192.0.2.10:3724, 192.0.2.11:3724,192.0.2.10:3724,[2001:db8::1]:3724",
  });

  assert.deepEqual(config.targets.auth, [{ host: "login.example.test", port: 1119 }]);
  assert.deepEqual(config.targets.game, [
    { host: "192.0.2.10", port: 3724 },
    { host: "192.0.2.11", port: 3724 },
    { host: "2001:db8::1", port: 3724 },
  ]);
  assert.equal(isConfigured(config), true);
  assert.deepEqual(config.errors, []);
});

test("une adresse mal formée est refusée et signalée, sans être répétée dans le message", () => {
  const config = loadStatusConfig({ WOW_STATUS_AUTH_TARGETS: "http://login.example.test:1119/x,login.example.test:1119" });

  assert.deepEqual(config.targets.auth, [{ host: "login.example.test", port: 1119 }]);
  assert.equal(config.errors.length, 1);
  assert.match(config.errors[0], /^WOW_STATUS_AUTH_TARGETS/);
  assert.doesNotMatch(config.errors[0], /http/);
});

test("parseTarget n'accepte que hôte:port", () => {
  for (const value of ["", "hôte", "example.test", "example.test:0", "example.test:65536", "example.test:abc", "a b:80", "-bad.test:80", "[zz]:80", "user@host:80", "host:80/path"]) {
    assert.equal(parseTarget(value), null, value);
  }
  assert.deepEqual(parseTarget("example.test:65535"), { host: "example.test", port: 65535 });
});

test("le nombre d'adresses par service est borné", () => {
  const many = Array.from({ length: MAX_TARGETS + 3 }, (_, index) => `192.0.2.${index + 1}:3724`).join(",");
  const config = loadStatusConfig({ WOW_STATUS_GAME_TARGETS: many });

  assert.equal(config.targets.game.length, MAX_TARGETS);
  assert.equal(config.errors.length, 1);
});

test("une durée hors bornes est remplacée par la valeur par défaut et signalée", () => {
  const config = loadStatusConfig({ WOW_STATUS_INTERVAL_SECONDS: "1", WOW_STATUS_TIMEOUT_MS: "abc", WOW_STATUS_DEGRADED_MS: "250" });

  assert.deepEqual([config.intervalMs, config.timeoutMs, config.degradedMs], [300_000, 3_000, 250]);
  assert.equal(config.errors.length, 2);
});

test("les adresses de la page Paramètres remplacent celles de l'environnement, service par service", () => {
  const env = { WOW_STATUS_AUTH_TARGETS: "login.example.test:1119", WOW_STATUS_GAME_TARGETS: "192.0.2.10:3724" };
  const config = loadStatusConfig(env, { authTargets: null, gameTargets: "203.0.113.5:3724\n203.0.113.6:3724; [2001:db8::1]:3724", label: " Bêta " });

  // Sans réglage pour ce service, l'environnement s'applique, sans restriction d'adresse.
  assert.deepEqual(config.targets.auth, [{ host: "login.example.test", port: 1119 }]);
  // Une adresse venue du site n'est sondée que si elle est publique.
  assert.deepEqual(config.targets.game, [
    { host: "203.0.113.5", port: 3724, publicOnly: true },
    { host: "203.0.113.6", port: 3724, publicOnly: true },
    { host: "2001:db8::1", port: 3724, publicOnly: true },
  ]);
  assert.deepEqual(config.fromSite, { auth: false, game: true });
  assert.equal(config.label, "Bêta");
  assert.deepEqual(config.targets.game.map(formatTarget), ["203.0.113.5:3724", "203.0.113.6:3724", "[2001:db8::1]:3724"]);
  assert.deepEqual(config.errors, []);
});

test("une liste vide enregistrée arrête la surveillance, sans retomber sur l'environnement", () => {
  const config = loadStatusConfig({ WOW_STATUS_GAME_TARGETS: "192.0.2.10:3724" }, { authTargets: "", gameTargets: "", label: null });

  assert.equal(isConfigured(config), false);
  assert.deepEqual(config.fromSite, { auth: true, game: true });
  assert.equal(config.label, "EU");
});

test("la péremption suit un intervalle long", () => {
  assert.equal(loadStatusConfig({ WOW_STATUS_INTERVAL_SECONDS: "600" }).staleAfterMs, 1_800_000);
});

test("sous un intervalle court, la péremption couvre le backoff", () => {
  // Un service en échec n'est recontrôlé que toutes les cinq minutes : sa mesure vaut jusque-là.
  assert.equal(loadStatusConfig({ WOW_STATUS_INTERVAL_SECONDS: "60" }).staleAfterMs, 360_000);
});
