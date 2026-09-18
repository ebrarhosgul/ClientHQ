CREATE TABLE "rate_limit_windows" (
	"subject" text NOT NULL,
	"action" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_windows_subject_action_window_start_pk" PRIMARY KEY("subject","action","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_window_start_idx" ON "rate_limit_windows" USING btree ("window_start");