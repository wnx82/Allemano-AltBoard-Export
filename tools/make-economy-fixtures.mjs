#!/usr/bin/env node
// Produit les fixtures Auctionator et NaowhForever à partir de vrais fichiers SavedVariables.
//
//   node tools/make-economy-fixtures.mjs <dossier-sortie> <Auctionator.lua> <NaowhForever.lua> <guid réel>=<guid fictif> ...
//
// Auctionator : garde un échantillon d'objets de l'hôtel des ventes « PvE » (ceux qui ont plusieurs
// jours de relevés en priorité), réencodé en CBOR comme le fait le client, et leurs prix marchands.
// Les prix ne sont pas des données personnelles ; la configuration et l'historique de mise en vente
// du joueur ne sont pas repris.
// NaowhForever : garde seulement NaowhForeverDB.account.profMakes, GUID remplacés.
// Format du client conservé : CRLF, aucune indentation, chaînes binaires échappées comme le jeu.

import fs from "node:fs";
import path from "node:path";

const [outDir, aucFile, naowhFile, ...guidSpecs] = process.argv.slice(2);
if (!outDir || !aucFile || !naowhFile) {
  console.error("usage: node tools/make-economy-fixtures.mjs <dossier-sortie> <Auctionator.lua> <NaowhForever.lua> <guid>=<guid fictif> ...");
  process.exit(2);
}
const guidMap = new Map(guidSpecs.map((spec) => spec.split("=")));

// --- Lua : lecture d'une chaîne entre guillemets, octet par octet -------------------------------
function readLuaString(src, start) {
  const out = [];
  let i = start + 1;
  for (;;) {
    const c = src[i];
    if (c === '"') return { bytes: Buffer.from(out), end: i + 1 };
    if (c === "\\") {
      const n = src[i + 1];
      if (/[0-9]/.test(n)) {
        let j = i + 1, d = "";
        while (d.length < 3 && /[0-9]/.test(src[j])) d += src[j++];
        out.push(Number(d));
        i = j;
        continue;
      }
      const map = { n: 10, r: 13, t: 9, "\\": 92, '"': 34, "\n": 10 };
      if (!(n in map)) throw new Error(`échappement inattendu \\${n}`);
      out.push(map[n]);
      i += 2;
      continue;
    }
    out.push(c.charCodeAt(0) & 0xff);
    i++;
  }
}

// Échappement du client WoW pour une chaîne binaire (observé : \n, \r, \000, \", \\).
function writeLuaString(bytes) {
  let s = '"';
  for (const b of bytes) {
    if (b === 0x5c) s += "\\\\";
    else if (b === 0x22) s += '\\"';
    else if (b === 0x0a) s += "\\n";
    else if (b === 0x0d) s += "\\r";
    else if (b === 0x00) s += "\\000";
    else s += String.fromCharCode(b);
  }
  return s + '"';
}

// --- CBOR minimal (entiers positifs, chaînes en octets, tables) ---------------------------------
function decodeCbor(b) {
  let p = 0;
  const arg = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) return b[p++];
    if (ai === 25) { p += 2; return b.readUInt16BE(p - 2); }
    if (ai === 26) { p += 4; return b.readUInt32BE(p - 4); }
    if (ai === 27) { p += 8; return Number(b.readBigUInt64BE(p - 8)); }
    throw new Error("longueur non prise en charge");
  };
  const item = () => {
    const x = b[p++], mt = x >> 5, ai = x & 31;
    if (mt === 0) return arg(ai);
    if (mt === 2 || mt === 3) { const n = arg(ai); const s = b.subarray(p, p + n).toString("latin1"); p += n; return s; }
    // Une table vide (l = {} par exemple) est écrite comme un tableau.
    if (mt === 4) { const n = arg(ai); const a = []; for (let k = 0; k < n; k++) a.push(item()); return a; }
    if (mt === 5) { const n = arg(ai); const o = new Map(); for (let k = 0; k < n; k++) { const key = item(); o.set(key, item()); } return o; }
    throw new Error(`type CBOR ${mt} non attendu`);
  };
  const v = item();
  if (p !== b.length) throw new Error("données CBOR en trop");
  return v;
}

function encodeCbor(value) {
  const parts = [];
  const head = (major, n) => {
    if (n < 24) parts.push(Buffer.from([(major << 5) | n]));
    else if (n < 0x100) parts.push(Buffer.from([(major << 5) | 24, n]));
    else if (n < 0x10000) { const h = Buffer.alloc(3); h[0] = (major << 5) | 25; h.writeUInt16BE(n, 1); parts.push(h); }
    else if (n < 0x100000000) { const h = Buffer.alloc(5); h[0] = (major << 5) | 26; h.writeUInt32BE(n, 1); parts.push(h); }
    else { const h = Buffer.alloc(9); h[0] = (major << 5) | 27; h.writeBigUInt64BE(BigInt(n), 1); parts.push(h); }
  };
  const write = (v) => {
    if (typeof v === "number") head(0, v);
    else if (typeof v === "string") { const s = Buffer.from(v, "latin1"); head(2, s.length); parts.push(s); }
    else if (Array.isArray(v)) { head(4, v.length); for (const x of v) write(x); }
    else { head(5, v.size); for (const [k, x] of v) { write(k); write(x); } }
  };
  write(value);
  return Buffer.concat(parts);
}

// --- Auctionator --------------------------------------------------------------------------------
const auc = fs.readFileSync(aucFile).toString("latin1");
const realmAt = auc.indexOf('["PvE"] = "');
if (realmAt < 0) throw new Error("hôtel des ventes « PvE » introuvable");
const { bytes } = readLuaString(auc, realmAt + '["PvE"] = '.length);
const db = decodeCbor(bytes);

const keysOf = (v) => (v instanceof Map ? [...v.keys()] : []);
const days = (entry) => new Set([...keysOf(entry.get("h")), ...keysOf(entry.get("l"))]).size;
const entries = [...db.entries()].filter(([, e]) => e instanceof Map);
// Objets à plusieurs jours de relevés d'abord (historique), puis à plus bas distinct (champ l), puis les autres.
const multi = entries.filter(([, e]) => days(e) >= 4 && keysOf(e.get("l")).length > 0).slice(0, 30);
const single = entries.filter(([, e]) => days(e) === 1).slice(0, 10);
const sample = new Map([...multi, ...single]);
sample.set("version", 2);

const vendorAt = auc.indexOf("AUCTIONATOR_VENDOR_PRICE_CACHE = {");
const vendorBlock = auc.slice(vendorAt, auc.indexOf("\n}", vendorAt));
const vendorLines = [...vendorBlock.matchAll(/\["(\d+)"\] = ([0-9.]+),/g)].slice(0, 15).map(([, k, v]) => `["${k}"] = ${v},`);

const aucLua = [
  "",
  "AUCTIONATOR_PRICE_DATABASE = {",
  '["__dbversion"] = 8,',
  `["PvE"] = ${writeLuaString(encodeCbor(sample))},`,
  "}",
  "AUCTIONATOR_VENDOR_PRICE_CACHE = {",
  ...vendorLines,
  "}",
  "",
].join("\r\n");
fs.writeFileSync(path.join(outDir, "auctionator-multi-day.lua"), Buffer.from(aucLua, "latin1"));
console.log(`auctionator-multi-day.lua : ${sample.size - 1} objets, ${vendorLines.length} prix marchands`);

// --- NaowhForever -------------------------------------------------------------------------------
const naowh = fs.readFileSync(naowhFile, "utf8");
const start = naowh.indexOf('["profMakes"] = {');
if (start < 0) throw new Error("profMakes introuvable");
// Fin du bloc : accolade fermante au même niveau.
let depth = 0, end = start;
for (let i = naowh.indexOf("{", start); i < naowh.length; i++) {
  if (naowh[i] === "{") depth++;
  else if (naowh[i] === "}" && --depth === 0) { end = i + 1; break; }
}
let block = naowh.slice(start, end);
for (const guid of block.match(/Player-\d+-[0-9A-F]+/g) ?? []) {
  if (!guidMap.has(guid)) throw new Error(`GUID sans remplacement : fournir ${guid}=<guid fictif>`);
}
for (const [real, fake] of guidMap) block = block.replaceAll(real, fake);
const naowhLua = ["", "NaowhForeverDB = {", '["account"] = {', block + ",", "},", "}", ""].join("\r\n");
fs.writeFileSync(path.join(outDir, "naowh-recipes.lua"), naowhLua, "utf8");
console.log(`naowh-recipes.lua : ${(block.match(/\["recipe"\]/g) ?? []).length} recettes`);
