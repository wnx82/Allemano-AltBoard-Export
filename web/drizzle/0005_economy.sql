CREATE TABLE "character_recipe_sources" (
	"character_id" bigint PRIMARY KEY NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_recipes" (
	"character_id" bigint NOT NULL,
	"spell_id" integer NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_recipes_character_id_spell_id_pk" PRIMARY KEY("character_id","spell_id")
);
--> statement-breakpoint
CREATE TABLE "farm_session_items" (
	"session_id" bigint NOT NULL,
	"phase" text NOT NULL,
	"location" text NOT NULL,
	"item_key" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "farm_session_items_session_id_phase_location_item_key_pk" PRIMARY KEY("session_id","phase","location","item_key"),
	CONSTRAINT "farm_session_items_phase_check" CHECK ("farm_session_items"."phase" in ('start', 'end')),
	CONSTRAINT "farm_session_items_location_check" CHECK ("farm_session_items"."location" in ('bags', 'bank')),
	CONSTRAINT "farm_session_items_quantity_check" CHECK ("farm_session_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "farm_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "farm_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" bigint NOT NULL,
	"label" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"start_source_at" timestamp with time zone NOT NULL,
	"end_source_at" timestamp with time zone,
	"start_money_copper" bigint,
	"end_money_copper" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farm_sessions_end_check" CHECK ("farm_sessions"."end_source_at" is null or "farm_sessions"."end_source_at" > "farm_sessions"."start_source_at")
);
--> statement-breakpoint
CREATE TABLE "market_imports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"machine_id" bigint,
	"sync_run_id" bigint,
	"content_hash" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"items_count" integer NOT NULL,
	"observations_count" integer NOT NULL,
	"first_day" date,
	"last_day" date,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_imports_market_account_content_key" UNIQUE("market_id","account_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "market_item_days" (
	"market_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"day" date NOT NULL,
	"low_copper" bigint NOT NULL,
	"high_copper" bigint NOT NULL,
	"available" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_item_days_market_id_item_key_day_pk" PRIMARY KEY("market_id","item_key","day"),
	CONSTRAINT "market_item_days_values_check" CHECK ("market_item_days"."low_copper" >= 0 and "market_item_days"."low_copper" <= "market_item_days"."high_copper" and "market_item_days"."available" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_item_latest" (
	"market_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"min_copper" bigint NOT NULL,
	"day" date NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"import_id" bigint,
	CONSTRAINT "market_item_latest_market_id_item_key_pk" PRIMARY KEY("market_id","item_key"),
	CONSTRAINT "market_item_latest_min_check" CHECK ("market_item_latest"."min_copper" > 0)
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "markets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flavor" text NOT NULL,
	"auction_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_flavor_auction_key_key" UNIQUE("flavor","auction_key")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"run_id" bigint NOT NULL,
	"rank" integer NOT NULL,
	"kind" text NOT NULL,
	"item_key" text,
	"spell_id" integer,
	"value_copper" bigint,
	"confidence" smallint NOT NULL,
	"horizon" text NOT NULL,
	"reason_codes" text[] NOT NULL,
	"inputs" jsonb NOT NULL,
	CONSTRAINT "opportunities_run_id_rank_pk" PRIMARY KEY("run_id","rank"),
	CONSTRAINT "opportunities_kind_check" CHECK ("opportunities"."kind" in ('CRAFT', 'PROCESS', 'DONT_CRAFT', 'SELL', 'KEEP', 'BUY', 'FARM')),
	CONSTRAINT "opportunities_confidence_check" CHECK ("opportunities"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "opportunity_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opportunity_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" bigint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"last_import_id" bigint,
	"data_through" date,
	"engine_version" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"opportunities_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_reagents" (
	"spell_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "recipe_reagents_spell_id_item_id_pk" PRIMARY KEY("spell_id","item_id"),
	CONSTRAINT "recipe_reagents_quantity_check" CHECK ("recipe_reagents"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"spell_id" integer PRIMARY KEY NOT NULL,
	"skill_line" integer,
	"output_item_id" integer NOT NULL,
	"output_quantity" integer NOT NULL,
	"cooldown" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_output_quantity_check" CHECK ("recipes"."output_quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "vendor_prices" (
	"item_key" text PRIMARY KEY NOT NULL,
	"price_copper" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vendor_prices_price_check" CHECK ("vendor_prices"."price_copper" > 0)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "market_history_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "auction_cut_percent" double precision;--> statement-breakpoint
ALTER TABLE "character_recipe_sources" ADD CONSTRAINT "character_recipe_sources_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_recipes" ADD CONSTRAINT "character_recipes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_recipes" ADD CONSTRAINT "character_recipes_spell_id_recipes_spell_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."recipes"("spell_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_session_items" ADD CONSTRAINT "farm_session_items_session_id_farm_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."farm_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_sessions" ADD CONSTRAINT "farm_sessions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_item_days" ADD CONSTRAINT "market_item_days_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_item_latest" ADD CONSTRAINT "market_item_latest_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_item_latest" ADD CONSTRAINT "market_item_latest_import_id_market_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."market_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_runs" ADD CONSTRAINT "opportunity_runs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_runs" ADD CONSTRAINT "opportunity_runs_last_import_id_market_imports_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."market_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reagents" ADD CONSTRAINT "recipe_reagents_spell_id_recipes_spell_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."recipes"("spell_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_recipes_spell_idx" ON "character_recipes" USING btree ("spell_id");--> statement-breakpoint
CREATE INDEX "farm_sessions_character_started_idx" ON "farm_sessions" USING btree ("character_id","started_at");--> statement-breakpoint
CREATE INDEX "market_imports_market_received_idx" ON "market_imports" USING btree ("market_id","received_at");--> statement-breakpoint
CREATE INDEX "market_item_days_market_day_idx" ON "market_item_days" USING btree ("market_id","day");--> statement-breakpoint
CREATE INDEX "opportunity_runs_market_computed_idx" ON "opportunity_runs" USING btree ("market_id","computed_at");--> statement-breakpoint
CREATE INDEX "recipe_reagents_item_idx" ON "recipe_reagents" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "recipes_output_item_idx" ON "recipes" USING btree ("output_item_id");