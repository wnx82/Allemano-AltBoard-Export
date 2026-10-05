#!/usr/bin/env node
// Génère l'icône de l'agent Windows et le favicon du tableau de bord.
//
//   node tools/make-icon.mjs
//
// Aucune dépendance. Chaque taille est dessinée à sa propre résolution, par suréchantillonnage,
// plutôt que réduite depuis une grande image : les petites tailles restent nettes. Le motif — deux
// flèches de synchronisation dorées autour d'une gemme bleue, sur une tuile sombre — reprend les
// couleurs du tableau de bord (web/src/app/globals.css).

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const TARGETS = [
  // Tailles demandées par Windows de 100 % à 250 % d'échelle ; 256 px sert aux grandes vignettes.
  { file: "../agent/src/AltBoardSync/AltBoardSync.ico", sizes: [16, 20, 24, 32, 40, 48, 64, 256] },
  { file: "../web/src/app/favicon.ico", sizes: [16, 32, 48, 256] },
];
const SUBSAMPLES = 8;

const hex = (value) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
const mix = (from, to, t) => from.map((channel, i) => channel + (to[i] - channel) * Math.min(1, Math.max(0, t)));
const radians = (degrees) => (degrees * Math.PI) / 180;

const BORDER = hex("#a9802f");
const TILE_TOP = hex("#1e2946");
const TILE_BOTTOM = hex("#0a0e19");
const GOLD_TOP = hex("#f7dc9c");
const GOLD_BOTTOM = hex("#c4933c");
// Facettes de la gemme : haut-gauche, haut-droite, bas-gauche, bas-droite.
const GEM = ["#c6d7ff", "#8fb1ff", "#6f9bff", "#456dcc"].map(hex);

// Une flèche part de TAIL et tourne dans le sens horaire jusqu'à sa pointe en TIP ; la seconde est
// sa symétrique par rapport au centre. Angles depuis l'axe des x, y vers le bas.
const TAIL = radians(18);
const TIP = radians(172);
const RING_TILT = radians(-38);

function geometry(size) {
  const margin = size < 20 ? 0 : Math.round(size * 0.03);
  const border = Math.max(1, Math.round(size * 0.022));
  const half = size / 2 - margin;
  const corner = half * 0.44;
  // Sous 2 px, le trait disparaît à 16 px.
  const stroke = Math.max(2, size * 0.098);
  const ring = size * 0.268;
  const headHalfWidth = stroke * 1.08;
  const headAngle = TIP - (stroke * 1.75) / ring;
  return {
    center: size / 2,
    half,
    corner,
    border,
    stroke,
    ring,
    headAngle,
    extent: ring + headHalfWidth,
    tail: [ring * Math.cos(TAIL), ring * Math.sin(TAIL)],
    head: [
      [(ring + headHalfWidth) * Math.cos(headAngle), (ring + headHalfWidth) * Math.sin(headAngle)],
      [(ring - headHalfWidth) * Math.cos(headAngle), (ring - headHalfWidth) * Math.sin(headAngle)],
      [ring * Math.cos(TIP), ring * Math.sin(TIP)],
    ],
    gemHalfWidth: size * 0.1,
    gemHalfHeight: size * 0.13,
    tilt: [Math.cos(RING_TILT), Math.sin(RING_TILT)],
  };
}

function inRoundedSquare(dx, dy, half, corner) {
  const qx = Math.abs(dx) - (half - corner);
  const qy = Math.abs(dy) - (half - corner);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= corner;
}

function inTriangle(x, y, [a, b, c]) {
  const side = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const ab = side(a, b);
  const bc = side(b, c);
  const ca = side(c, a);
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

function inArrow(dx, dy, g) {
  const angle = Math.atan2(dy, dx);
  if (Math.abs(Math.hypot(dx, dy) - g.ring) <= g.stroke / 2 && angle >= TAIL && angle <= g.headAngle) return true;
  if (Math.hypot(dx - g.tail[0], dy - g.tail[1]) <= g.stroke / 2) return true;
  return inTriangle(dx, dy, g.head);
}

// Couleur opaque du point (x, y), ou null hors de la tuile.
function colorAt(x, y, g) {
  const dx = x - g.center;
  const dy = y - g.center;
  if (!inRoundedSquare(dx, dy, g.half, g.corner)) return null;
  if (!inRoundedSquare(dx, dy, g.half - g.border, g.corner - g.border)) return BORDER;

  const rx = dx * g.tilt[0] + dy * g.tilt[1];
  const ry = dy * g.tilt[0] - dx * g.tilt[1];
  if (inArrow(rx, ry, g) || inArrow(-rx, -ry, g)) return mix(GOLD_TOP, GOLD_BOTTOM, (dy + g.extent) / (2 * g.extent));

  if (Math.abs(dx) / g.gemHalfWidth + Math.abs(dy) / g.gemHalfHeight <= 1) return GEM[(dy >= 0 ? 2 : 0) + (dx >= 0 ? 1 : 0)];
  return mix(TILE_TOP, TILE_BOTTOM, (dy + g.half) / (2 * g.half));
}

// RGBA non prémultiplié, lignes de haut en bas.
function render(size) {
  const g = geometry(size);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const color = colorAt(x + (sx + 0.5) / SUBSAMPLES, y + (sy + 0.5) / SUBSAMPLES, g);
          if (!color) continue;
          covered++;
          for (let i = 0; i < 3; i++) sum[i] += color[i];
        }
      }
      if (covered === 0) continue;
      const at = (y * size + x) * 4;
      for (let i = 0; i < 3; i++) rgba[at + i] = Math.round(sum[i] / covered);
      rgba[at + 3] = Math.round((255 * covered) / SUBSAMPLES ** 2);
    }
  }
  return rgba;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits par canal, RGBA
  const stride = size * 4 + 1; // un octet de filtre (0 = aucun) en tête de ligne
  const rows = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Bitmap d'icône : BITMAPINFOHEADER, pixels BGRA de bas en haut, puis masque de transparence 1 bit.
function dib(size, rgba) {
  const maskStride = Math.ceil(size / 32) * 4;
  const maskStart = 40 + size * size * 4;
  const out = Buffer.alloc(maskStart + maskStride * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8); // hauteur doublée : image puis masque
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(out.length - 40, 20);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + (row * size + x) * 4;
      out[to] = rgba[from + 2];
      out[to + 1] = rgba[from + 1];
      out[to + 2] = rgba[from];
      out[to + 3] = rgba[from + 3];
      if (rgba[from + 3] === 0) out[maskStart + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header[entry] = size & 0xff; // 0 signifie 256
    header[entry + 1] = size & 0xff;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

for (const { file, sizes } of TARGETS) {
  const output = fileURLToPath(new URL(file, import.meta.url));
  // Seule l'entrée 256 px est en PNG, les autres en bitmap : le format que tout lecteur d'icônes accepte.
  const images = sizes.map((size) => {
    const rgba = render(size);
    return { size, data: size === 256 ? png(size, rgba) : dib(size, rgba) };
  });
  fs.writeFileSync(output, ico(images));
  console.log(`${output} : ${sizes.join(", ")} px`);
}
