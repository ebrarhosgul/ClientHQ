CREATE TABLE "invitation_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"contact_email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_sends_contact_email_lowercase_check" CHECK ("invitation_sends"."contact_email" = lower("invitation_sends"."contact_email"))
);
--> statement-breakpoint
ALTER TABLE "invitation_sends" ADD CONSTRAINT "invitation_sends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_sends_org_id_contact_email_sent_at_idx" ON "invitation_sends" USING btree ("org_id","contact_email","sent_at");--> statement-breakpoint
CREATE INDEX "invitation_sends_org_id_sent_at_idx" ON "invitation_sends" USING btree ("org_id","sent_at");