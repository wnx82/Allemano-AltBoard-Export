#!/usr/bin/env node
// Produit des fixtures anonymisées à partir de vrais fichiers AltBoard.lua.
//
//   node tools/anonymize-altboard.mjs <dossier-sortie> <nom>=<AltBoard.lua> [<nom>=<fichier> ...]
//
// Le format d'origine est conservé octet pour octet (CRLF, ordre des clés, absence d'indentation) :
// seuls les GUID, les noms de personnage et les noms de guilde sont remplacés. La correspondance
// est commune à tous les fichiers d'un même appel, pour qu'un personnage garde la même identité
// d'une fixture à l'autre.

import fs from "node:fs";
import path from "node:path";

// Noms volontairement accentués, avec apostrophes droite et typographique, pour garder la valeur de test.
const NAMES = [
  "Élodie Brisefer", "Zoé D'Ambre", "Ægir Çélèste", "Noël L’Hermite", "Märta Ünsal", "Bjørn Ångström",
  "Anaïs Du-Pont", "Þórr Ødegård", "Íñigo Peña", "Ève Saint-Clair",
];
const GUILDS = ["Les Sans-Souci", "L'Ordre d’Émeraude", "Çà et Là"];

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) {
  console.error("usage: node tools/anonymize-altboard.mjs <dossier-sortie> <nom>=<AltBoard.lua> ...");
  process.exit(2);
}

const guidMap = new Map();
const nameMap = new Map();
const guildMap = new Map();
const mapped = (map, original, make) => {
  if (!map.has(original)) map.set(original, make(map.size));
  return map.get(original);
};
const fakeGuid = (guid) => mapped(guidMap, guid, (n) => `Player-9999-${String(n + 1).padStart(8, "0")}`);
const fakeName = (name) => mapped(nameMap, name, (n) => NAMES[n] ?? `Perso ${n + 1}`);
const fakeGuild = (guild) => mapped(guildMap, guild, (n) => GUILDS[n] ?? `Guilde ${n + 1}`);

const GUID = /Player-\d+-[0-9A-F]{8}/g;
// Dans AltBoardDB { chars { <guid> { name, guild … } } } : les champs du personnage sont à la profondeur 3.
const CHARACTER_DEPTH = 3;

function anonymize(text) {
  let depth = 0;
  let inChars = false;
  const lines = text.split("\n").map((rawLine) => {
    const hasCr = rawLine.endsWith("\r");
    let line = hasCr ? rawLine.slice(0, -1) : rawLine;

    if (depth === 1 && line === '["chars"] = {') inChars = true;
    if (inChars && depth === CHARACTER_DEPTH) {
      const field = /^\["(name|guild)"\] = "(.*)",$/.exec(line);
      if (field) {
        const replacement = field[1] === "name" ? fakeName(field[2]) : fakeGuild(field[2]);
        line = `["${field[1]}"] = "${replacement}",`;
      }
    }

    if (line.endsWith("{")) depth++;
    else if (line === "}," || line === "}") {
      depth--;
      if (depth === 1) inChars = false;
    }

    line = line.replace(GUID, (guid) => fakeGuid(guid));
    return hasCr ? `${line}\r` : line;
  });
  return lines.join("\n");
}

fs.mkdirSync(outDir, { recursive: true });
const outputs = [];
for (const spec of specs) {
  const separator = spec.indexOf("=");
  const name = spec.slice(0, separator);
  const input = spec.slice(separator + 1);
  const output = anonymize(fs.readFileSync(input, "utf8"));
  outputs.push({ name, output });
}

// Contrôle : aucune identité d'origine ne doit subsister, où que ce soit dans les sorties.
const originals = [...guidMap.keys(), ...nameMap.keys(), ...guildMap.keys()];
for (const { name, output } of outputs) {
  const leaked = originals.filter((original) => output.includes(original)).length;
  if (leaked > 0) {
    console.error(`${name}: ${leaked} identité(s) d'origine encore présente(s), aucun fichier écrit`);
    process.exit(1);
  }
}

for (const { name, output } of outputs) {
  fs.writeFileSync(path.join(outDir, `${name}.lua`), output);
  console.log(`${name}.lua écrit (${Buffer.byteLength(output)} octets)`);
}
console.log(`${guidMap.size} personnage(s), ${guildMap.size} guilde(s) anonymisé(s)`);
