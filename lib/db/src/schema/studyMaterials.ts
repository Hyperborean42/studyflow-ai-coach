import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studyMaterialsTable = pgTable("study_materials", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  summary: text("summary"),
  fileType: text("file_type").notNull().default("tekst"),
  chapter: text("chapter"),
  examType: text("exam_type"),
  tags: text("tags"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStudyMaterialSchema = createInsertSchema(studyMaterialsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStudyMaterial = z.infer<typeof insertStudyMaterialSchema>;
export type StudyMaterial = typeof studyMaterialsTable.$inferSelect;
