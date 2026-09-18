CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"report" jsonb,
	CONSTRAINT "cron_runs_outcome_check" CHECK ("cron_runs"."outcome" in ('ok', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "cron_runs_started_at_idx" ON "cron_runs" USING btree ("started_at");