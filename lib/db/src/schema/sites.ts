import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { serversTable } from "./servers";

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").notNull().references(() => serversTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  repoUrl: text("repo_url"),
  repoToken: text("repo_token"),
  deployPath: text("deploy_path").notNull(),
  buildCommand: text("build_command"),
  siteType: text("site_type").notNull().default("static"),
  status: text("status").notNull().default("stopped"),
  sslInstalled: boolean("ssl_installed").notNull().default(false),
  sslExpiresAt: timestamp("ssl_expires_at", { withTimezone: true }),
  autoSync: boolean("auto_sync").notNull().default(false),
  webhookToken: text("webhook_token"),
  lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSiteSchema = createInsertSchema(sitesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;
