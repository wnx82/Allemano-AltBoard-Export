import assert from "node:assert/strict";
import { test } from "node:test";
import { compareProfessions } from "./professions";

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const profession = (skillLine: number, name: string, rank: number | null, isPrimary = true) => ({ skillLine, name, rank, maxRank: 300, isPrimary });

const character = (id: number, name: string, level: number, professions: ReturnType<typeof profession>[]) => ({ id, name, level, professions });

const CHARACTERS = [
  character(1, "Élodie", 60, [profession(171, "Alchimie", 300), profession(182, "Herboristerie", 275), profession(185, "Cuisine", 150, false)]),
  character(2, "Ægir", 40, [profession(171, "Alchimie", 300), profession(186, "Minage", null)]),
  character(3, "Zoé", 25, [profession(186, "Minage", 110), profession(185, "Cuisine", 225, false)]),
  character(4, "Noël", 12, [profession(165, "Travail du cuir", 40)]),
  character(5, "Brise", 3, []),
];

test("chaque métier liste ses personnages, du plus avancé au moins avancé", () => {
  const { primary, secondary } = compareProfessions(CHARACTERS, collator.compare);

  assert.deepEqual(
    primary.map((row) => [row.name, row.holders.map((holder) => `${holder.character.name} ${holder.rank ?? "?"}`)]),
    [
      // À rang égal, l'ordre reçu est conservé.
      ["Alchimie", ["Élodie 300", "Ægir 300"]],
      ["Herboristerie", ["Élodie 275"]],
      // Un rang inconnu passe après un rang connu.
      ["Minage", ["Zoé 110", "Ægir ?"]],
      ["Travail du cuir", ["Noël 40"]],
    ],
  );
  assert.deepEqual(
    secondary.map((row) => [row.name, row.holders.map((holder) => holder.character.name)]),
    [["Cuisine", ["Zoé", "Élodie"]]],
  );
});

test("les emplacements de métier principal libres sont comptés par personnage", () => {
  const { openSlots } = compareProfessions(CHARACTERS, collator.compare);

  // Un métier secondaire n'occupe pas d'emplacement.
  assert.deepEqual(
    openSlots.map(({ character: holder, open }) => [holder.name, open]),
    [
      ["Zoé", 1],
      ["Noël", 1],
      ["Brise", 2],
    ],
  );
});

test("sans personnage, la comparaison est vide", () => {
  assert.deepEqual(compareProfessions([], collator.compare), { primary: [], secondary: [], openSlots: [] });
});
