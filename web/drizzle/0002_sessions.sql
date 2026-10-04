CREATE TABLE "character_sessions" (
	"character_id" bigint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"duration_seconds" integer,
	"xp_gained" integer,
	"levels" smallint,
	"zone" text,
	"tag" text,
	"in_progress" boolean DEFAULT false NOT NULL,
	CONSTRAINT "character_sessions_character_id_started_at_pk" PRIMARY KEY("character_id","started_at"),
	CONSTRAINT "character_sessions_values_check" CHECK ("character_sessions"."duration_seconds" >= 0 and "character_sessions"."xp_gained" >= 0 and "character_sessions"."levels" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_snapshots" ADD COLUMN "xp_max" integer;--> statement-breakpoint
ALTER TABLE "character_sessions" ADD CONSTRAINT "character_sessions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Relevés antérieurs : l'expérience du niveau est celle du personnage tant qu'il est à ce niveau.
UPDATE "character_snapshots" AS s SET "xp_max" = c."xp_max" FROM "characters" AS c WHERE c."id" = s."character_id" AND s."level" = c."level" AND s."xp_max" IS NULL AND c."xp_max" IS NOT NULL;
