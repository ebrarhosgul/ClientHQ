/**
 * Drizzle schema.
 *
 * Deliberately empty. The real tables (Organization, User, Membership,
 * Subscription, Client, ClientContact, Project, Deliverable, Invoice,
 * InvoiceLineItem, ProcessedWebhookEvent) are designed and written by
 * feature 3, "Data model & migrations". Spec 0001 only sketches them.
 *
 * Everything a table needs to be tenant safe is settled there too: every
 * tenant scoped table carries and indexes `org_id`.
 */

export {};
