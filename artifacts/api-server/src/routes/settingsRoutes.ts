import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userSettingsTable, notificationSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  UpdateSettingsBody,
  UpdateNotificationSettingsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const existing = await db.select().from(userSettingsTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(userSettingsTable).values({}).returning();
  return created;
}

async function getOrCreateNotificationSettings() {
  const existing = await db.select().from(notificationSettingsTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(notificationSettingsTable).values({}).returning();
  return created;
}

router.get("/settings", async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.put("/settings", async (req, res) => {
  const body = UpdateSettingsBody.parse(req.body);
  const existing = await getOrCreateSettings();

  const updateData: Record<string, unknown> = {};
  if (body.userName !== undefined) updateData.userName = body.userName;
  if (body.difficultyLevel !== undefined) updateData.difficultyLevel = body.difficultyLevel;
  if (body.preferredLanguage !== undefined) updateData.preferredLanguage = body.preferredLanguage;
  if (body.voiceEnabled !== undefined) updateData.voiceEnabled = body.voiceEnabled;
  if (body.coachStyle !== undefined) updateData.coachStyle = body.coachStyle;
  if (body.studyReminders !== undefined) updateData.studyReminders = body.studyReminders;
  if (body.weeklyGoalHours !== undefined) updateData.weeklyGoalHours = body.weeklyGoalHours;

  const [settings] = await db.update(userSettingsTable)
    .set(updateData)
    .where(eq(userSettingsTable.id, existing.id))
    .returning();

  res.json(settings);
});

router.get("/notifications/settings", async (_req, res) => {
  const settings = await getOrCreateNotificationSettings();
  res.json(settings);
});

router.put("/notifications/settings", async (req, res) => {
  const body = UpdateNotificationSettingsBody.parse(req.body);
  const existing = await getOrCreateNotificationSettings();

  const updateData: Record<string, unknown> = {};
  if (body.enabled !== undefined) updateData.enabled = body.enabled;
  if (body.eveningReminder !== undefined) updateData.eveningReminder = body.eveningReminder;
  if (body.eveningReminderTime !== undefined) updateData.eveningReminderTime = body.eveningReminderTime;
  if (body.pushSubscription !== undefined) updateData.pushSubscription = body.pushSubscription;

  const [updated] = await db.update(notificationSettingsTable)
    .set(updateData)
    .where(eq(notificationSettingsTable.id, existing.id))
    .returning();

  res.json(updated);
});

export default router;
