CREATE TABLE "character_level_times" (
	"character_id" bigint NOT NULL,
	"level" smallint NOT NULL,
	"played_seconds" integer,
	"wall_seconds" integer,
	"reached_at" timestamp with time zone,
	"zone" text,
	CONSTRAINT "character_level_times_character_id_level_pk" PRIMARY KEY("character_id","level"),
	CONSTRAINT "character_level_times_seconds_check" CHECK ("character_level_times"."played_seconds" >= 0 and "character_level_times"."wall_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "character_playtime" (
	"character_id" bigint PRIMARY KEY NOT NULL,
	"total_seconds" integer,
	"measured_at" timestamp with time zone,
	"current_level" smallint,
	"current_level_start_seconds" integer,
	"current_level_started_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "character_level_times" ADD CONSTRAINT "character_level_times_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_playtime" ADD CONSTRAINT "character_playtime_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;