import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Conventions : identifiants bigint générés, dates en timestamptz, argent en pièces de cuivre.
// Seules les colonnes alimentées par des données réellement observées dans AltBoard existent
// (voir docs/ALTBOARD-DATA-MODEL.md).

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Référentiel
// ---------------------------------------------------------------------------

export const machines = pgTable("machines", {
  id: id(),
  machineUuid: uuid("machine_uuid").notNull().unique(),
  hostname: text("hostname"),
  displayName: text("display_name"),
  agentVersion: text("agent_version"),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Jeton d'agent : seul son SHA-256 est stocké. Lié à une machine à sa première utilisation.
export const agentTokens = pgTable("agent_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  machineId: bigint("machine_id", { mode: "number" }).references(() => machines.id),
  createdAt: createdAt(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const wowAccounts = pgTable("wow_accounts", {
  id: id(),
  // Empreinte stable du nom de dossier WTF\Account\<COMPTE> : identique sur tous les PC.
  accountKey: text("account_key").notNull().unique(),
  folderHint: text("folder_hint"),
  displayName: text("display_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSyncAt: ts("last_sync_at"),
});

export const machineAccounts = pgTable(
  "machine_accounts",
  {
    machineId: bigint("machine_id", { mode: "number" })
      .notNull()
      .references(() => machines.id),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => wowAccounts.id),
    flavor: text("flavor"),
    addonSchema: integer("addon_schema"),
    addonVersion: text("addon_version"),
    lastFileHash: text("last_file_hash"),
    lastFileModifiedAt: ts("last_file_modified_at"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.accountId] })],
);

export const realms = pgTable("realms", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

// Référentiel d'objets issu de AltBoardDB.items, partagé par tous les personnages.
export const items = pgTable("items", {
  itemKey: text("item_key").primaryKey(),
  itemId: integer("item_id").notNull(),
  suffixId: integer("suffix_id"),
  name: text("name"),
  quality: smallint("quality"),
  icon: integer("icon"),
  link: text("link"),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

export const characters = pgTable(
  "characters",
  {
    id: id(),
    // GUID joueur (clé de AltBoardDB.chars) : seul identifiant fiable, le nom n'est pas unique.
    guid: text("guid").notNull().unique(),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => wowAccounts.id),
    realmId: bigint("realm_id", { mode: "number" })
      .notNull()
      .references(() => realms.id),
    name: text("name").notNull(),
    class: text("class"),
    race: text("race"),
    faction: text("faction"),
    level: smallint("level"),
    xp: integer("xp"),
    xpMax: integer("xp_max"),
    restedXp: integer("rested_xp"),
    guild: text("guild"),
    zone: text("zone"),
    moneyCopper: bigint("money_copper", { mode: "number" }),
    itemLevel: doublePrecision("item_level"),
    hidden: boolean("hidden").notNull().default(false),
    bagSlotsUsed: smallint("bag_slots_used"),
    bagSlotsTotal: smallint("bag_slots_total"),
    bankSlotsUsed: smallint("bank_slots_used"),
    bankSlotsTotal: smallint("bank_slots_total"),
    // Horodatages fournis par l'addon (lastSeen, statsAt, bagsAt, bankAt).
    sourceLastSeenAt: ts("source_last_seen_at").notNull(),
    statsAt: ts("stats_at"),
    bagsAt: ts("bags_at"),
    bankAt: ts("bank_at"),
    contentHash: text("content_hash").notNull(),
    lastMachineId: bigint("last_machine_id", { mode: "number" }).references(() => machines.id),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSyncAt: ts("last_sync_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("characters_account_id_idx").on(t.accountId),
    index("characters_realm_id_idx").on(t.realmId),
    check("characters_money_copper_check", sql`${t.moneyCopper} >= 0`),
  ],
);

const characterId = () =>
  bigint("character_id", { mode: "number" })
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" });

export const characterMachines = pgTable(
  "character_machines",
  {
    characterId: characterId(),
    machineId: bigint("machine_id", { mode: "number" })
      .notNull()
      .references(() => machines.id),
    sourceLastSeenAt: ts("source_last_seen_at").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.machineId] })],
);

export const characterStats = pgTable("character_stats", {
  characterId: characterId().primaryKey(),
  strength: integer("strength"),
  agility: integer("agility"),
  stamina: integer("stamina"),
  intellect: integer("intellect"),
  spirit: integer("spirit"),
  armor: integer("armor"),
  health: integer("health"),
  power: integer("power"),
  powerType: text("power_type"),
  attackPower: integer("attack_power"),
  rangedAttackPower: integer("ranged_attack_power"),
  crit: doublePrecision("crit"),
  rangedCrit: doublePrecision("ranged_crit"),
  hit: doublePrecision("hit"),
  dodge: doublePrecision("dodge"),
  parry: doublePrecision("parry"),
  block: doublePrecision("block"),
  defense: integer("defense"),
  spellPower: integer("spell_power"),
  spellCrit: doublePrecision("spell_crit"),
  healing: integer("healing"),
  spellHit: doublePrecision("spell_hit"),
  resFire: integer("res_fire"),
  resNature: integer("res_nature"),
  resFrost: integer("res_frost"),
  resShadow: integer("res_shadow"),
  resArcane: integer("res_arcane"),
});

export const characterProfessions = pgTable(
  "character_professions",
  {
    characterId: characterId(),
    skillLine: integer("skill_line").notNull(),
    name: text("name").notNull(),
    rank: integer("rank"),
    maxRank: integer("max_rank"),
    isPrimary: boolean("is_primary").notNull().default(false),
    icon: integer("icon"),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.skillLine] })],
);

export const characterEquipment = pgTable(
  "character_equipment",
  {
    characterId: characterId(),
    slot: smallint("slot").notNull(),
    itemId: integer("item_id"),
    enchantId: integer("enchant_id"),
    name: text("name"),
    quality: smallint("quality"),
    itemLevel: integer("item_level"),
    icon: integer("icon"),
    link: text("link"),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.slot] }),
    check("character_equipment_slot_check", sql`${t.slot} between 1 and 19`),
  ],
);

export const characterReputations = pgTable(
  "character_reputations",
  {
    characterId: characterId(),
    factionId: integer("faction_id").notNull(),
    name: text("name").notNull(),
    groupName: text("group_name"),
    reaction: smallint("reaction"),
    currentValue: integer("current_value"),
    minValue: integer("min_value"),
    maxValue: integer("max_value"),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.factionId] })],
);

// Clé = nom localisé : l'addon ne fournit pas d'identifiant de monnaie.
export const characterCurrencies = pgTable(
  "character_currencies",
  {
    characterId: characterId(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    maxQuantity: integer("max_quantity"),
    icon: integer("icon"),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.name] })],
);

// Sacs et banque. item_key référence items sans clé étrangère : un fichier partiel peut citer
// un objet absent du référentiel.
export const characterItems = pgTable(
  "character_items",
  {
    characterId: characterId(),
    location: text("location").notNull(),
    itemKey: text("item_key").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.location, t.itemKey] }),
    check("character_items_location_check", sql`${t.location} in ('bags', 'bank')`),
    check("character_items_quantity_check", sql`${t.quantity} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Journal des synchronisations
// ---------------------------------------------------------------------------

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    machineId: bigint("machine_id", { mode: "number" }).references(() => machines.id),
    requestId: text("request_id").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    status: text("status").notNull(),
    accountsDetected: integer("accounts_detected").notNull().default(0),
    charactersDetected: integer("characters_detected").notNull().default(0),
    charactersCreated: integer("characters_created").notNull().default(0),
    charactersUpdated: integer("characters_updated").notNull().default(0),
    charactersUnchanged: integer("characters_unchanged").notNull().default(0),
    charactersStale: integer("characters_stale").notNull().default(0),
    snapshotsCreated: integer("snapshots_created").notNull().default(0),
    errorsCount: integer("errors_count").notNull().default(0),
    sourceHash: text("source_hash"),
    agentVersion: text("agent_version"),
    schemaVersion: integer("schema_version"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("sync_runs_machine_started_idx").on(t.machineId, t.startedAt),
    check("sync_runs_status_check", sql`${t.status} in ('success', 'partial', 'failed')`),
  ],
);

export const syncErrors = pgTable("sync_errors", {
  id: id(),
  syncRunId: bigint("sync_run_id", { mode: "number" })
    .notNull()
    .references(() => syncRuns.id, { onDelete: "cascade" }),
  accountKey: text("account_key"),
  characterGuid: text("character_guid"),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export const characterSnapshots = pgTable(
  "character_snapshots",
  {
    id: id(),
    characterId: characterId(),
    // = lastSeen de la source : rejouer la même synchronisation ne crée pas de doublon.
    capturedAt: ts("captured_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    syncRunId: bigint("sync_run_id", { mode: "number" }).references(() => syncRuns.id, {
      onDelete: "set null",
    }),
    snapshotHash: text("snapshot_hash").notNull(),
    level: smallint("level"),
    xp: integer("xp"),
    moneyCopper: bigint("money_copper", { mode: "number" }),
    itemLevel: doublePrecision("item_level"),
    restedXp: integer("rested_xp"),
    data: jsonb("data").notNull(),
  },
  (t) => [unique("character_snapshots_character_captured_key").on(t.characterId, t.capturedAt)],
);

// ---------------------------------------------------------------------------
// Accès au tableau de bord
// ---------------------------------------------------------------------------

export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastLoginAt: ts("last_login_at"),
});

// Session : seul le SHA-256 de l'identifiant de session est stocké.
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);
