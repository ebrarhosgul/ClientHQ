CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"default_currency" char(3) DEFAULT 'USD' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
