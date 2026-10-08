CREATE TABLE "server_status_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "server_status_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"checked_at" timestamp with time zone NOT NULL,
	"service" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text NOT NULL,
	"latency_ms" integer,
	"targets_up" smallint NOT NULL,
	"targets_total" smallint NOT NULL,
	"source" text NOT NULL,
	"error" text,
	CONSTRAINT "server_status_checks_service_check" CHECK ("server_status_checks"."service" in ('auth', 'game')),
	CONSTRAINT "server_status_checks_status_check" CHECK ("server_status_checks"."status" in ('up', 'degraded', 'down', 'unknown')),
	CONSTRAINT "server_status_checks_targets_check" CHECK ("server_status_checks"."targets_up" >= 0 and "server_status_checks"."targets_up" <= "server_status_checks"."targets_total")
);
--> statement-breakpoint
CREATE INDEX "server_status_checks_service_checked_idx" ON "server_status_checks" USING btree ("service","checked_at");