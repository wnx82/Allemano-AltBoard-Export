import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TARGETS } from "@/lib/status/config";
import { parseCutoffInput, parseLabelInput, parseTargetsInput } from "./input";

const NOW = new Date("2026-11-04T18:00:00Z");

test("les adresses saisies sont normalisées, une par ligne ou séparées, sans doublon", () => {
  const parsed = parseTargetsInput(" Test.Actual.Battle.net:1119 \r\n24.105.52.94:3724, 24.105.52.94:3724;[2606:4700:4700::1111]:3724\n");

  assert.deepEqual(parsed, { ok: true, value: "test.actual.battle.net:1119,24.105.52.94:3724,[2606:4700:4700::1111]:3724" });
});

test("une liste vide est une valeur valide : rien à surveiller", () => {
  assert.deepEqual(parseTargetsInput("  \n "), { ok: true, value: "" });
});

test("une adresse mal formée est refusée, avec son rang et sans être répétée", () => {
  const parsed = parseTargetsInput("24.105.52.94:3724\nhttp://saisie.test:3724/x");

  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? "" : parsed.error, /^Adresse n° 2 : la forme attendue est hôte:port/);
  assert.doesNotMatch(parsed.ok ? "" : parsed.error, /saisie/);
});

test("une adresse locale ou privée est refusée dès la saisie", () => {
  for (const value of ["127.0.0.1:5432", "10.0.0.15:9120", "10.0.0.1:22", "169.254.169.254:80", "[::1]:3724", "[fd00::1]:3724", "[::ffff:10.0.0.15]:3724"]) {
    const parsed = parseTargetsInput(value);
    assert.equal(parsed.ok, false, value);
    assert.match(parsed.ok ? "" : parsed.error, /seule une adresse publique/, value);
  }
});

test("un nom d'hôte est accepté à la saisie : il est jugé à sa résolution", () => {
  assert.deepEqual(parseTargetsInput("localhost:3724"), { ok: true, value: "localhost:3724" });
});

test("le nombre d'adresses par service est borné", () => {
  const addresses = (count: number) => Array.from({ length: count }, (_, index) => `203.0.113.${index + 1}:3724`).join("\n");

  assert.equal(parseTargetsInput(addresses(MAX_TARGETS)).ok, true);
  assert.deepEqual(parseTargetsInput(addresses(MAX_TARGETS + 1)), { ok: false, error: `${MAX_TARGETS} adresses au plus par service.` });
});

test("le libellé est rogné ; vide, il rend la main au libellé par défaut", () => {
  assert.deepEqual(parseLabelInput("  Bêta "), { ok: true, value: "Bêta" });
  assert.deepEqual(parseLabelInput("   "), { ok: true, value: null });
  assert.equal(parseLabelInput("x".repeat(25)).ok, false);
  assert.equal(parseLabelInput("Bê\u0000ta").ok, false);
});

test("sans date limite, la réinitialisation porte jusqu'à maintenant", () => {
  assert.deepEqual(parseCutoffInput("", NOW), { ok: true, value: NOW });
});

test("la date limite est un instant avec fuseau, jamais dans le futur", () => {
  assert.deepEqual(parseCutoffInput("2026-11-04T17:00:00.000Z", NOW), { ok: true, value: new Date("2026-11-04T17:00:00Z") });
  assert.deepEqual(parseCutoffInput("2026-11-04T18:30:00+02:00", NOW), { ok: true, value: new Date("2026-11-04T16:30:00Z") });
  assert.deepEqual(parseCutoffInput("2026-11-04T18:00:01.000Z", NOW), { ok: false, error: "La date ne peut pas être dans le futur." });
  // Sans fuseau, l'heure dépendrait de l'horloge du serveur : refusée.
  for (const value of ["2026-11-04T17:00", "04/11/2026", "demain", "2026-13-45T99:99:00Z"]) {
    assert.deepEqual(parseCutoffInput(value, NOW), { ok: false, error: "Date invalide." }, value);
  }
});
