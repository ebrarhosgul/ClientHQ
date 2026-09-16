CREATE TABLE "invoice_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_events_kind_check" CHECK ("invoice_events"."kind" in ('issued', 'paid', 'voided', 'overdue', 'notified', 'notification_failed')),
	CONSTRAINT "invoice_events_from_status_check" CHECK ("invoice_events"."from_status" is null or "invoice_events"."from_status" in ('draft', 'sent', 'paid', 'overdue', 'void')),
	CONSTRAINT "invoice_events_to_status_check" CHECK ("invoice_events"."to_status" is null or "invoice_events"."to_status" in ('draft', 'sent', 'paid', 'overdue', 'void')),
	CONSTRAINT "invoice_events_statuses_by_kind_check" CHECK (("invoice_events"."kind" in ('issued', 'paid', 'voided', 'overdue') and "invoice_events"."from_status" is not null and "invoice_events"."to_status" is not null) or ("invoice_events"."kind" in ('notified', 'notification_failed') and "invoice_events"."from_status" is null and "invoice_events"."to_status" is null))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_events_org_id_invoice_id_created_at_idx" ON "invoice_events" USING btree ("org_id","invoice_id","created_at");