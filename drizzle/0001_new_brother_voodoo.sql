ALTER TABLE "clients" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_address_line1" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_address_line2" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_city" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_region" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_postal_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_country" text;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_email_lowercase_check" CHECK ("clients"."company_email" is null or "clients"."company_email" = lower("clients"."company_email"));