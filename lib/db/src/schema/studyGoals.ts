import { pgTable, serial, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studyGoalsTable = pgTable("study_goals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  targetDate: timestamp("target_date").notNull(),
  hoursPerWeek: real("hours_per_week").notNull(),
  progress: real("progress").notNull().default(0),
  status: text("status").notNull().default("actief"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStudyGoalSchema = createInsertSchema(studyGoalsTable).omit({ id: true, createdAt: true });
export type InsertStudyGoal = z.infer<typeof insertStudyGoalSchema>;
export type StudyGoal = typeof studyGoalsTable.$inferSelect;
