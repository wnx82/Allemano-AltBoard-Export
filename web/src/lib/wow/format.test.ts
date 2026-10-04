import assert from "node:assert/strict";
import { test } from "node:test";
import { classKey, classLabel, formatItemLevel, formatMoney, formatRelative, fractionalLevel, progressPercent, splitMoney } from "./format";

const nbsp = (text: string) => text.replace(/[  ]/g, " ");

test("l'argent en cuivre est découpé en or, argent et cuivre", () => {
  assert.deepEqual(splitMoney(80964), { gold: 8, silver: 9, copper: 64 });
  assert.equal(formatMoney(80964), "8 po 9 pa 64 pc");
  assert.equal(formatMoney(284), "2 pa 84 pc");
  assert.equal(formatMoney(7), "7 pc");
  assert.equal(formatMoney(0), "0 pc");
  assert.equal(formatMoney(10_000), "1 po 0 pa 0 pc");
  assert.equal(nbsp(formatMoney(21_474_836_470_000)), "2 147 483 647 po 0 pa 0 pc");
  assert.equal(formatMoney(null), "—");
});

test("une classe inconnue est affichée telle quelle, jamais devinée", () => {
  assert.equal(classLabel("MAGE"), "Mage");
  assert.equal(classLabel("TINKER"), "TINKER");
  assert.equal(classLabel(null), "Classe inconnue");
  assert.equal(classKey("MAGE"), "MAGE");
  assert.equal(classKey("TINKER"), "UNKNOWN");
  assert.equal(classKey(null), "UNKNOWN");
});

test("la progression est bornée et tolère les données absentes", () => {
  assert.equal(progressPercent(88, 150), 59);
  assert.equal(progressPercent(300, 150), 100);
  assert.equal(progressPercent(-5, 150), 0);
  assert.equal(progressPercent(10, 0), null);
  assert.equal(progressPercent(null, 150), null);
});

test("le niveau porte sa part d'expérience, sans jamais atteindre le niveau suivant", () => {
  assert.equal(fractionalLevel(26, 17_000, 34_000), 26.5);
  assert.equal(fractionalLevel(26, 0, 34_000), 26);
  assert.equal(fractionalLevel(26, 34_000, 34_000), 26.99);
  assert.equal(fractionalLevel(26, 99_999, 34_000), 26.99);
  // Expérience inconnue : le niveau seul, jamais une estimation.
  assert.equal(fractionalLevel(26, null, 34_000), 26);
  assert.equal(fractionalLevel(26, 500, null), 26);
  assert.equal(fractionalLevel(26, 500, 0), 26);
});

test("le niveau d'objet garde une décimale", () => {
  assert.equal(formatItemLevel(15.9375), "15,9");
  assert.equal(formatItemLevel(5), "5");
  assert.equal(formatItemLevel(null), "—");
});

test("les durées relatives sont exprimées en français", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(formatRelative(new Date("2026-10-04T11:59:40Z"), now), "à l'instant");
  assert.equal(formatRelative(new Date("2026-10-04T11:56:00Z"), now), "il y a 4 minutes");
  assert.equal(formatRelative(new Date("2026-10-04T09:00:00Z"), now), "il y a 3 heures");
  assert.equal(formatRelative(new Date("2026-10-03T12:00:00Z"), now), "hier");
  assert.equal(formatRelative(null, now), "jamais");
});
