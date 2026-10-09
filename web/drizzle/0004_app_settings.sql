CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"status_auth_targets" text,
	"status_game_targets" text,
	"status_label" text,
	"characters_cutoff_at" timestamp with time zone,
	"characters_reset_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row_check" CHECK ("app_settings"."id" = 1)
);
