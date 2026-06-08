import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cloudflareConfigsTable = pgTable("cloudflare_configs", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  email: text("email").notNull(),
  apiToken: text("api_token").notNull(),
  zoneId: text("zone_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCloudflareConfigSchema = createInsertSchema(cloudflareConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCloudflareConfig = z.infer<typeof insertCloudflareConfigSchema>;
export type CloudflareConfig = typeof cloudflareConfigsTable.$inferSelect;
