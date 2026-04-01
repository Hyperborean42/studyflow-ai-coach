import { pgTable, serial, text, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userSettingsTable = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userName: text("user_name").notNull().default("Student"),
  difficultyLevel: text("difficulty_level").notNull().default("gemiddeld"),
  preferredLanguage: text("preferred_language").notNull().default("nl"),
  voiceEnabled: boolean("voice_enabled").notNull().default(true),
  coachStyle: text("coach_style").notNull().default("gebalanceerd"),
  studyReminders: boolean("study_reminders").notNull().default(true),
  weeklyGoalHours: real("weekly_goal_hours").notNull().default(10),
});

export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettingsTable.$inferSelect;

export const notificationSettingsTable = pgTable("notification_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  eveningReminder: boolean("evening_reminder").notNull().default(true),
  eveningReminderTime: text("evening_reminder_time").notNull().default("21:00"),
  pushSubscription: text("push_subscription"),
});

export const insertNotificationSettingsSchema = createInsertSchema(notificationSettingsTable).omit({ id: true });
export type InsertNotificationSettings = z.infer<typeof insertNotificationSettingsSchema>;
export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
