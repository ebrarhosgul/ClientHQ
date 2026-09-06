import { relations } from "drizzle-orm";

import { clientContacts, clients } from "./clients";
import { memberships, organizations, subscriptions, users } from "./identity";
import { invoiceLineItems, invoices } from "./invoices";
import { deliverables, projects } from "./projects";

/**
 * How the tables relate, for `db.query.<table>.findMany({ with: ... })`.
 * Foreign keys live on the tables; this only teaches the relational query
 * builder to follow them.
 */

export const organizationsRelations = relations(
  organizations,
  ({ many, one }) => ({
    memberships: many(memberships),
    subscription: one(subscriptions),
    clients: many(clients),
    clientContacts: many(clientContacts),
    projects: many(projects),
    deliverables: many(deliverables),
    invoices: many(invoices),
    invoiceLineItems: many(invoiceLineItems),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  clientContacts: many(clientContacts),
  uploadedDeliverables: many(deliverables),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.orgId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.orgId],
    references: [organizations.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.orgId],
    references: [organizations.id],
  }),
  contacts: many(clientContacts),
  projects: many(projects),
  invoices: many(invoices),
}));

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  organization: one(organizations, {
    fields: [clientContacts.orgId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [clientContacts.clientId],
    references: [clients.id],
  }),
  user: one(users, { fields: [clientContacts.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.orgId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  deliverables: many(deliverables),
}));

export const deliverablesRelations = relations(deliverables, ({ one }) => ({
  organization: one(organizations, {
    fields: [deliverables.orgId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [deliverables.projectId],
    references: [projects.id],
  }),
  uploadedBy: one(users, {
    fields: [deliverables.uploadedByUserId],
    references: [users.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [invoices.orgId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  lineItems: many(invoiceLineItems),
}));

export const invoiceLineItemsRelations = relations(
  invoiceLineItems,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [invoiceLineItems.orgId],
      references: [organizations.id],
    }),
    invoice: one(invoices, {
      fields: [invoiceLineItems.invoiceId],
      references: [invoices.id],
    }),
  }),
);
