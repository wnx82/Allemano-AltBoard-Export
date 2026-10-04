CREATE TABLE "admin_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"machine_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "character_currencies" (
	"character_id" bigint NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"max_quantity" integer,
	"icon" integer,
	CONSTRAINT "character_currencies_character_id_name_pk" PRIMARY KEY("character_id","name")
);
--> statement-breakpoint
CREATE TABLE "character_equipment" (
	"character_id" bigint NOT NULL,
	"slot" smallint NOT NULL,
	"item_id" integer,
	"enchant_id" integer,
	"name" text,
	"quality" smallint,
	"item_level" integer,
	"icon" integer,
	"link" text,
	CONSTRAINT "character_equipment_character_id_slot_pk" PRIMARY KEY("character_id","slot"),
	CONSTRAINT "character_equipment_slot_check" CHECK ("character_equipment"."slot" between 1 and 19)
);
--> statement-breakpoint
CREATE TABLE "character_items" (
	"character_id" bigint NOT NULL,
	"location" text NOT NULL,
	"item_key" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "character_items_character_id_location_item_key_pk" PRIMARY KEY("character_id","location","item_key"),
	CONSTRAINT "character_items_location_check" CHECK ("character_items"."location" in ('bags', 'bank')),
	CONSTRAINT "character_items_quantity_check" CHECK ("character_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "character_machines" (
	"character_id" bigint NOT NULL,
	"machine_id" bigint NOT NULL,
	"source_last_seen_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_machines_character_id_machine_id_pk" PRIMARY KEY("character_id","machine_id")
);
--> statement-breakpoint
CREATE TABLE "character_professions" (
	"character_id" bigint NOT NULL,
	"skill_line" integer NOT NULL,
	"name" text NOT NULL,
	"rank" integer,
	"max_rank" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"icon" integer,
	"position" smallint NOT NULL,
	CONSTRAINT "character_professions_character_id_skill_line_pk" PRIMARY KEY("character_id","skill_line")
);
--> statement-breakpoint
CREATE TABLE "character_reputations" (
	"character_id" bigint NOT NULL,
	"faction_id" integer NOT NULL,
	"name" text NOT NULL,
	"group_name" text,
	"reaction" smallint,
	"current_value" integer,
	"min_value" integer,
	"max_value" integer,
	CONSTRAINT "character_reputations_character_id_faction_id_pk" PRIMARY KEY("character_id","faction_id")
);
--> statement-breakpoint
CREATE TABLE "character_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "character_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" bigint NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_run_id" bigint,
	"snapshot_hash" text NOT NULL,
	"level" smallint,
	"xp" integer,
	"money_copper" bigint,
	"item_level" double precision,
	"rested_xp" integer,
	"data" jsonb NOT NULL,
	CONSTRAINT "character_snapshots_character_captured_key" UNIQUE("character_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "character_stats" (
	"character_id" bigint PRIMARY KEY NOT NULL,
	"strength" integer,
	"agility" integer,
	"stamina" integer,
	"intellect" integer,
	"spirit" integer,
	"armor" integer,
	"health" integer,
	"power" integer,
	"power_type" text,
	"attack_power" integer,
	"ranged_attack_power" integer,
	"crit" double precision,
	"ranged_crit" double precision,
	"hit" double precision,
	"dodge" double precision,
	"parry" double precision,
	"block" double precision,
	"defense" integer,
	"spell_power" integer,
	"spell_crit" double precision,
	"healing" integer,
	"spell_hit" double precision,
	"res_fire" integer,
	"res_nature" integer,
	"res_frost" integer,
	"res_shadow" integer,
	"res_arcane" integer
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "characters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guid" text NOT NULL,
	"account_id" bigint NOT NULL,
	"realm_id" bigint NOT NULL,
	"name" text NOT NULL,
	"class" text,
	"race" text,
	"faction" text,
	"level" smallint,
	"xp" integer,
	"xp_max" integer,
	"rested_xp" integer,
	"guild" text,
	"zone" text,
	"money_copper" bigint,
	"item_level" double precision,
	"hidden" boolean DEFAULT false NOT NULL,
	"bag_slots_used" smallint,
	"bag_slots_total" smallint,
	"bank_slots_used" smallint,
	"bank_slots_total" smallint,
	"source_last_seen_at" timestamp with time zone NOT NULL,
	"stats_at" timestamp with time zone,
	"bags_at" timestamp with time zone,
	"bank_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"last_machine_id" bigint,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_guid_unique" UNIQUE("guid"),
	CONSTRAINT "characters_money_copper_check" CHECK ("characters"."money_copper" >= 0)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_key" text PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"suffix_id" integer,
	"name" text,
	"quality" smallint,
	"icon" integer,
	"link" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_accounts" (
	"machine_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"flavor" text,
	"addon_schema" integer,
	"addon_version" text,
	"last_file_hash" text,
	"last_file_modified_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_accounts_machine_id_account_id_pk" PRIMARY KEY("machine_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "machines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"machine_uuid" uuid NOT NULL,
	"hostname" text,
	"display_name" text,
	"agent_version" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_machine_uuid_unique" UNIQUE("machine_uuid")
);
--> statement-breakpoint
CREATE TABLE "realms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "realms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_errors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sync_run_id" bigint NOT NULL,
	"account_key" text,
	"character_guid" text,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"machine_id" bigint,
	"request_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"accounts_detected" integer DEFAULT 0 NOT NULL,
	"characters_detected" integer DEFAULT 0 NOT NULL,
	"characters_created" integer DEFAULT 0 NOT NULL,
	"characters_updated" integer DEFAULT 0 NOT NULL,
	"characters_unchanged" integer DEFAULT 0 NOT NULL,
	"characters_stale" integer DEFAULT 0 NOT NULL,
	"snapshots_created" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"source_hash" text,
	"agent_version" text,
	"schema_version" integer,
	"duration_ms" integer,
	CONSTRAINT "sync_runs_status_check" CHECK ("sync_runs"."status" in ('success', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "wow_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wow_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_key" text NOT NULL,
	"folder_hint" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	CONSTRAINT "wow_accounts_account_key_unique" UNIQUE("account_key")
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_currencies" ADD CONSTRAINT "character_currencies_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_machines" ADD CONSTRAINT "character_machines_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_machines" ADD CONSTRAINT "character_machines_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_professions" ADD CONSTRAINT "character_professions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reputations" ADD CONSTRAINT "character_reputations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_stats" ADD CONSTRAINT "character_stats_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_realm_id_realms_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."realms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_last_machine_id_machines_id_fk" FOREIGN KEY ("last_machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_accounts" ADD CONSTRAINT "machine_accounts_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_accounts" ADD CONSTRAINT "machine_accounts_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_account_id_idx" ON "characters" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "characters_realm_id_idx" ON "characters" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_runs_machine_started_idx" ON "sync_runs" USING btree ("machine_id","started_at");