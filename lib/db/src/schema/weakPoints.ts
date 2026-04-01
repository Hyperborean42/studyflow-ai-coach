import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weakPointsTable = pgTable("weak_points", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  topic: text("topic").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("gemiddeld"),
  suggestedAction: text("suggested_action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWeakPointSchema = createInsertSchema(weakPointsTable).omit({ id: true, createdAt: true });
export type InsertWeakPoint = z.infer<typeof insertWeakPointSchema>;
export type WeakPoint = typeof weakPointsTable.$inferSelect;

export const studySessionsTable = pgTable("study_sessions", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull().defaultNow(),
  durationMinutes: text("duration_minutes").notNull().default("0"),
  subject: text("subject"),
  notes: text("notes"),
});
