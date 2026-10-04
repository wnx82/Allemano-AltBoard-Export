import * as z from "zod";

// Contrat de POST /api/sync, version 1. Miroir de agent/src/AltBoardSync.Core/Sync/SyncPayload.cs.
// Objets stricts : tout champ inconnu fait refuser le document. Toute évolution incompatible
// passe par une nouvelle valeur de schemaVersion.

export const SUPPORTED_SCHEMA_VERSION = 1;

// PostgreSQL refuse l'octet nul dans un texte : il est rejeté ici plutôt qu'en pleine transaction.
const text = (max: number) => z.string().min(1).max(max).regex(/^[^\u0000]*$/);
const name = text(120);
const link = text(600);
const int = z.int();
const nonNegativeInt = z.int().min(0);
const int32 = z.int().min(-2_147_483_648).max(2_147_483_647);
const count = z.int().min(0).max(2_147_483_647);
const unixSeconds = z.int().min(1).max(32_503_680_000); // jusqu'à l'an 3000
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const itemKey = z.string().regex(/^\d{1,9}(:-?\d{1,9})?$/);
const finite = z.number();
const instant = z.iso.datetime({ offset: true });

const stats = z.strictObject({
  strength: int32.optional(),
  agility: int32.optional(),
  stamina: int32.optional(),
  intellect: int32.optional(),
  spirit: int32.optional(),
  armor: int32.optional(),
  health: int32.optional(),
  power: int32.optional(),
  powerType: name.optional(),
  attackPower: int32.optional(),
  rangedAttackPower: int32.optional(),
  crit: finite.optional(),
  rangedCrit: finite.optional(),
  hit: finite.optional(),
  dodge: finite.optional(),
  parry: finite.optional(),
  block: finite.optional(),
  defense: int32.optional(),
  spellPower: int32.optional(),
  spellCrit: finite.optional(),
  healing: int32.optional(),
  spellHit: finite.optional(),
  resFire: int32.optional(),
  resNature: int32.optional(),
  resFrost: int32.optional(),
  resShadow: int32.optional(),
  resArcane: int32.optional(),
});

const gear = z.strictObject({
  slot: z.int().min(1).max(19),
  itemId: count.optional(),
  enchantId: count.optional(),
  name: name.optional(),
  quality: z.int().min(0).max(32_767).optional(),
  itemLevel: int32.optional(),
  icon: int32.optional(),
  link: link.optional(),
});

const profession = z.strictObject({
  skillLine: count,
  name,
  rank: int32.optional(),
  max: int32.optional(),
  primary: z.boolean(),
  icon: int32.optional(),
});

const reputation = z.strictObject({
  factionId: z.int().min(1).max(2_147_483_647),
  name,
  group: name.optional(),
  reaction: z.int().min(-32_768).max(32_767).optional(),
  current: int32.optional(),
  min: int32.optional(),
  max: int32.optional(),
});

const currency = z.strictObject({
  name,
  quantity: count,
  max: int32.optional(),
  icon: int32.optional(),
});

const container = z.strictObject({
  at: unixSeconds,
  slotsUsed: z.int().min(0).max(32_767).optional(),
  slotsTotal: z.int().min(0).max(32_767).optional(),
  items: z.array(z.strictObject({ key: itemKey, count })).max(5_000),
});

// Temps de jeu relevé par l'addon Allemano Ledger (facultatif : absent si l'addon n'est pas installé).
const level = z.int().min(0).max(32_767);
const playtime = z.strictObject({
  totalSeconds: count.optional(),
  measuredAt: unixSeconds.optional(),
  current: z.strictObject({ level, startTotalSeconds: count.optional(), startedAt: unixSeconds.optional() }).optional(),
  levels: z
    .array(z.strictObject({ level, playedSeconds: count.optional(), wallSeconds: count.optional(), reachedAt: unixSeconds.optional(), zone: name.optional() }))
    .max(200),
});

const character = z.strictObject({
  guid: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name,
  realm: name,
  lastSeen: unixSeconds,
  class: name.optional(),
  race: name.optional(),
  faction: name.optional(),
  level: z.int().min(0).max(32_767).optional(),
  xp: nonNegativeInt.max(2_147_483_647).optional(),
  xpMax: nonNegativeInt.max(2_147_483_647).optional(),
  restedXp: nonNegativeInt.max(2_147_483_647).optional(),
  guild: name.optional(),
  zone: name.optional(),
  moneyCopper: nonNegativeInt.optional(),
  itemLevel: finite.optional(),
  hidden: z.boolean(),
  stats: stats.optional(),
  statsAt: unixSeconds.optional(),
  gear: z.array(gear).max(19),
  professions: z.array(profession).max(32),
  reputations: z.array(reputation).max(1_000),
  currencies: z.array(currency).max(1_000),
  bags: container.optional(),
  bank: container.optional(),
  playtime: playtime.optional(),
});

const item = z.strictObject({
  key: itemKey,
  itemId: count,
  suffixId: int32.optional(),
  name: name.optional(),
  quality: z.int().min(0).max(32_767).optional(),
  icon: int32.optional(),
  link: link.optional(),
});

const account = z.strictObject({
  accountKey: sha256,
  folderHint: text(16),
  flavor: text(40),
  addonSchema: int.min(0).max(1_000_000).optional(),
  addonVersion: text(40).optional(),
  file: z.strictObject({ hash: sha256, modifiedAt: instant, size: nonNegativeInt }),
  characters: z.array(character).max(200),
  items: z.array(item).max(50_000),
  warnings: z.array(text(400)).max(50),
});

export const syncPayloadSchema = z.strictObject({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  agentVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][0-9A-Za-z.-]{1,40})?$/),
  generatedAt: instant,
  machine: z.strictObject({
    uuid: z.uuid(),
    hostname: text(120),
    displayName: text(120).optional(),
  }),
  accounts: z.array(account).max(50),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;
export type AccountPayload = SyncPayload["accounts"][number];
export type CharacterPayload = AccountPayload["characters"][number];
export type ItemPayload = AccountPayload["items"][number];
